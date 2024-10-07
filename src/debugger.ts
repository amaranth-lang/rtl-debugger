import * as net from 'net';
import * as vscode from 'vscode';
import { NodeStreamLink } from './cxxrtl/link';
import { CXXRTLConnection, CXXRTLDebugItem, CXXRTLDebugItemType, CXXRTLNodeDesignation, CXXRTLSimulationStatus } from './connection';
import { TimePoint } from './model/time';
import { Scope } from './model/scope';
import { Variable } from './model/variable';
import { StatusItemController } from './ui/status';

export enum CXXRTLSessionStatus {
    Absent = "absent",
    Starting = "starting",
    Running = "running",
}

export class CXXRTLDebugger {
    private statusItemController: StatusItemController;
    private terminal: vscode.Terminal | null = null;
    private connection: CXXRTLConnection | null = null;

    // Session properties.

    private _sessionStatus: CXXRTLSessionStatus = CXXRTLSessionStatus.Absent;
    public get sessionStatus() { return this._sessionStatus;}
    private _onDidChangeSessionStatus: vscode.EventEmitter<CXXRTLSessionStatus> = new vscode.EventEmitter<CXXRTLSessionStatus>();
    readonly onDidChangeSessionStatus: vscode.Event<CXXRTLSessionStatus> = this._onDidChangeSessionStatus.event;

    private _currentTime: TimePoint = new TimePoint(0n, 0n);
    public get currentTime() { return this._currentTime;}
    private _onDidChangeCurrentTime: vscode.EventEmitter<TimePoint> = new vscode.EventEmitter<TimePoint>();
    readonly onDidChangeCurrentTime: vscode.Event<TimePoint> = this._onDidChangeCurrentTime.event;

    // Simulation properties.

    private simulationStatusUpdateTimeout: NodeJS.Timeout | null = null;

    private _simulationStatus: CXXRTLSimulationStatus = CXXRTLSimulationStatus.Finished;
    public get simulationStatus() { return this._simulationStatus; }
    private _onDidChangeSimulationStatus: vscode.EventEmitter<CXXRTLSimulationStatus> = new vscode.EventEmitter<CXXRTLSimulationStatus>();
    readonly onDidChangeSimulationStatus: vscode.Event<CXXRTLSimulationStatus> = this._onDidChangeSimulationStatus.event;

    private _latestTime: TimePoint = new TimePoint(0n, 0n);
    public get latestTime() { return this._latestTime;}
    private _onDidChangeLatestTime: vscode.EventEmitter<TimePoint> = new vscode.EventEmitter<TimePoint>();
    readonly onDidChangeLatestTime: vscode.Event<TimePoint> = this._onDidChangeLatestTime.event;

    constructor() {
        this.statusItemController = new StatusItemController(this);
    }

    public dispose() {
        this._onDidChangeCurrentTime.dispose();
        this._onDidChangeSimulationStatus.dispose();
    }

    public async startSession(): Promise<void> {
        if (this.terminal !== null) {
            vscode.window.showErrorMessage("A debug session is already in the process of being started.");
            return;
        }

        const configuration = vscode.workspace.getConfiguration('rtlDebugger');
        if (configuration.command.length !== 0) {
            this.terminal = vscode.window.createTerminal({
                name: 'Simulation Process',
                shellPath: configuration.command[0],
                shellArgs: configuration.command.slice(1),
                cwd: configuration.cwd,
                env: configuration.env,
                isTransient: true,
                iconPath: new vscode.ThemeIcon('debug-console')
            });
            this.setSessionStatus(CXXRTLSessionStatus.Starting);

            const processId = await this.terminal.processId;
            console.log("[RTL Debugger] Launched process %d", processId);

            setTimeout(() => {
                const socket = net.createConnection({ port: configuration.port, host: '::1' }, () => {
                    vscode.window.showInformationMessage("Connected to the CXXRTL server.");

                    (async () => {
                        this.connection = new CXXRTLConnection(new NodeStreamLink(socket));
                        this.setSessionStatus(CXXRTLSessionStatus.Running);
                        this.updateSimulationStatus();
                        console.log("[RTL Debugger] Initialized");
                    })().catch(() => {
                        this.stopSession();
                    });
                });
                socket.on('error', (err: any) => {
                    if (err.code === 'ECONNREFUSED') {
                        vscode.window.showErrorMessage("The connection to the CXXRTL server was refused.");
                    } else {
                        vscode.window.showErrorMessage(`The connection to the CXXRTL server has failed: ${err.code}.`);
                    }
                    this.stopSession();
                });
                socket.on('close', (hadError) => {
                    if (!hadError) {
                        vscode.window.showInformationMessage("Disconnected from the CXXRTL server.");
                    }
                    this.stopSession();
                });
            }, 500); // FIXME
        } else {
            const OpenSettings = "Open Settings";
            const selection = await vscode.window.showErrorMessage("Configure the launch command to start a debug session.", OpenSettings);
            if (selection === OpenSettings) {
                vscode.commands.executeCommand('workbench.action.openSettings', 'rtlDebugger.command');
            }
        }
    }

    public stopSession() {
        this.terminal?.dispose();
        this.terminal = null;

        this.connection?.dispose();
        this.connection = null;

        this.setSessionStatus(CXXRTLSessionStatus.Absent);
        this._currentTime = TimePoint.ZERO;

        this.setSimulationStatus(CXXRTLSimulationStatus.Finished, TimePoint.ZERO);
    }

    public async stepForward(): Promise<void> {
        if (this.currentTime.lessThan(this.latestTime)) {
            this._currentTime = new TimePoint(this.currentTime.secs, this.currentTime.femtos + 1000000n);
            this._onDidChangeCurrentTime.fire(this.currentTime);
        }
    }

    public async stepBackward(): Promise<void> {
        if (this.currentTime.greaterThan(TimePoint.ZERO)) {
            this._currentTime = new TimePoint(this.currentTime.secs, this.currentTime.femtos - 1000000n);
            this._onDidChangeCurrentTime.fire(this.currentTime);
        }
    }

    public async runSimulation(): Promise<void> {
        await this.connection!.runSimulation();
        await this.updateSimulationStatus();
    }

    public async runSimulationUntil(): Promise<void> {
        const untilTime = await vscode.window.showInputBox({
            placeHolder: '10 ms',
            prompt: 'Enter the requested simulation time.',
            validateInput(value) {
                try {
                    TimePoint.fromString(value);
                    return null;
                } catch (e) {
                    if (e instanceof SyntaxError) {
                        return e.message;
                    } else {
                        throw e;
                    }
                }
            },
        });
        if (untilTime !== undefined) {
            await this.connection!.runSimulation({ untilTime: TimePoint.fromString(untilTime) });
            await this.updateSimulationStatus();
        }
    }

    public async pauseSimulation(): Promise<void> {
        const latestTime = await this.connection!.pauseSimulation();
        this.setSimulationStatus(CXXRTLSimulationStatus.Paused, latestTime);
    }

    public async getVariableValues(variables: CXXRTLDebugItem[]): Promise<Map<string, bigint>> {
        if (!this.connection) {
            return new Map();
        }
        const designations = [];
        for (const variable of variables) {
            if (variable.type === CXXRTLDebugItemType.Node) {
                designations.push(new CXXRTLNodeDesignation(variable));
            }
        }
        const reference = await this.connection.referenceItems("getVariableValues", designations);
        const samples = await this.connection.queryInterval(this.currentTime, this.currentTime, reference);
        await this.connection.referenceItems("getVariableValues", []);
        if (samples.length !== 1) {
            throw new Error("Expected one sample");
        }
        return new Map(Array.from(samples[0].values().entries()).map(([designation, value]) => [designation.name, value]));
    }

    private async updateSimulationStatus(): Promise<void> {
        if (!this.connection) {
            return;
        }
        const { status, latestTime } = await this.connection.getSimulationStatus();
        this.setSimulationStatus(status, latestTime);
    }

    private setSessionStatus(sessionState: CXXRTLSessionStatus): void {
        if (this._sessionStatus !== sessionState) {
            this._sessionStatus = sessionState;
            this._onDidChangeSessionStatus.fire(sessionState);
        }
    }

    private setSimulationStatus(simulationState: CXXRTLSimulationStatus, latestTime: TimePoint): void {
        if (this._simulationStatus !== simulationState) {
            this._simulationStatus = simulationState;
            this._onDidChangeSimulationStatus.fire(simulationState);
        }
        if (!this._latestTime.equals(latestTime)) {
            this._latestTime = latestTime;
            this._onDidChangeLatestTime.fire(latestTime);
        }
        if (simulationState === CXXRTLSimulationStatus.Running) {
            this.simulationStatusUpdateTimeout = setTimeout(() => this.updateSimulationStatus(), 100);
        } else if (this.simulationStatusUpdateTimeout) {
            clearTimeout(this.simulationStatusUpdateTimeout);
            this.simulationStatusUpdateTimeout = null;
        }
    }

    // new API

    private async getVariablesForScope(cxxrtlScopeName: string): Promise<Variable[]> {
        const cxxrtlResponse = await this.connection!.connection.listItems({
            type: 'command',
            command: 'list_items',
            scope: cxxrtlScopeName,
        });
        return Object.entries(cxxrtlResponse.items).map(([cxxrtlName, cxxrtlDesc]) =>
            Variable.fromCXXRTL(cxxrtlName, cxxrtlDesc));
    }

    public async getRootScope(): Promise<Scope> {
        const cxxrtlResponse = await this.connection!.connection.listScopes({
            type: 'command',
            command: 'list_scopes',
        });
        let rootScope: Scope | undefined;
        const scopeStack: Scope[][] = [];
        for (const [cxxrtlName, cxxrtlDesc] of Object.entries(cxxrtlResponse.scopes)) {
            const nestedScopes: Scope[] = [];
            const nestedVariables: Thenable<Variable[]> = {
                // NormallyPromises are evaluated eagerly; this Thenable does it lazily.
                then: (onfulfilled, onrejected) => {
                    return this.getVariablesForScope(cxxrtlName).then(onfulfilled, onrejected);
                }
            };
            const scope = Scope.fromCXXRTL(cxxrtlName, cxxrtlDesc, nestedScopes, nestedVariables);
            const scopeName = cxxrtlName === '' ? [] : cxxrtlName.split(' ');
            while (1 + scopeName.length <= scopeStack.length) {
                scopeStack.pop();
            }
            if (scopeStack.length > 0) {
                scopeStack.at(-1)!.push(scope);
            }
            scopeStack.push(nestedScopes);
            if (cxxrtlName === '') {
                rootScope = scope;
            }
        }
        return rootScope!;
    }
}
