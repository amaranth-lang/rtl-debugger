import * as net from 'net';
import * as vscode from 'vscode';
import { NodeStreamLink } from './cxxrtl/link';
import { Connection } from './cxxrtl/client';
import { TimeInterval, TimePoint } from './model/time';
import { Scope } from './model/scope';
import { Variable } from './model/variable';
import { StatusBarItem } from './ui/status';
import { BoundReference, Reference, Sample } from './model/sample';

export enum CXXRTLSimulationStatus {
    Paused = 'paused',
    Running = 'running',
    Finished = 'finished',
}

export enum CXXRTLSessionStatus {
    Absent = 'absent',
    Starting = 'starting',
    Running = 'running',
}

export class CXXRTLDebugger {
    private statusBarItem: StatusBarItem;
    private terminal: vscode.Terminal | null = null;
    private connection: Connection | null = null;

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
        this.statusBarItem = new StatusBarItem(this);
    }

    public dispose() {
        this.statusBarItem.dispose();
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
                        this.connection = new Connection(new NodeStreamLink(socket));
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
        await this.connection!.runSimulation({
            type: 'command',
            command: 'run_simulation',
            until_time: null,
            until_diagnostics: [],
            sample_item_values: true,
        });
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
            await this.connection!.runSimulation({
                type: 'command',
                command: 'run_simulation',
                until_time: TimePoint.fromString(untilTime).toCXXRTL(),
                until_diagnostics: [],
                sample_item_values: true,
            });
            await this.updateSimulationStatus();
        }
    }

    public async pauseSimulation(): Promise<void> {
        const cxxrtlResponse = await this.connection!.pauseSimulation({
            type: 'command',
            command: 'pause_simulation',
        });
        const latestTime = TimePoint.fromCXXRTL(cxxrtlResponse.time);
        this.setSimulationStatus(CXXRTLSimulationStatus.Paused, latestTime);
    }

    private async updateSimulationStatus(): Promise<void> {
        if (!this.connection) {
            return;
        }
        const cxxrtlResponse = await this.connection.getSimulationStatus({
            type: 'command',
            command: 'get_simulation_status',
        });
        this.setSimulationStatus(
            cxxrtlResponse.status as CXXRTLSimulationStatus,
            TimePoint.fromCXXRTL(cxxrtlResponse.latest_time)
        );
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

    private async getVariablesForScope(cxxrtlScopeName: string): Promise<Variable[]> {
        const cxxrtlResponse = await this.connection!.listItems({
            type: 'command',
            command: 'list_items',
            scope: cxxrtlScopeName,
        });
        return Object.entries(cxxrtlResponse.items).map(([cxxrtlName, cxxrtlDesc]) =>
            Variable.fromCXXRTL(cxxrtlName, cxxrtlDesc));
    }

    public async getRootScope(): Promise<Scope> {
        const cxxrtlResponse = await this.connection!.listScopes({
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

    private readonly referenceEpochs: Map<string, number> = new Map();

    private advanceReferenceEpoch(name: string): number {
        const epoch = (this.referenceEpochs.get(name) || 0) + 1;
        this.referenceEpochs.set(name, epoch);
        return epoch;
    }

    private verifyReferenceEpoch(name: string, requestedEpoch: number) {
        const currentEpoch = this.referenceEpochs.get(name);
        if (currentEpoch !== requestedEpoch) {
            throw new ReferenceError(
                `Querying out-of-date reference ${name}#${requestedEpoch}; ` +
                `the current binding is ${name}#${currentEpoch}`);
        }
    }

    public bindReference(name: string, reference: Reference): BoundReference {
        const epoch = this.advanceReferenceEpoch(name);
        // Note that we do not wait for the command to complete. Although it is possible for
        // the command to fail, this would only happen if one of the designations is invalid,
        // which should never happen absent bugs. We still report the error in that case.
        this.connection!.referenceItems({
            type: 'command',
            command: 'reference_items',
            reference: name,
            items: reference.cxxrtlItemDesignations()
        }).catch((error) => {
            console.error(`[CXXRTL] invalid designation while binding reference`,
                `${name}#${epoch}`, error);
        });
        return new BoundReference(name, epoch, reference);
    }

    public async queryInterval(interval: TimeInterval, reference: BoundReference): Promise<Sample[]> {
        this.verifyReferenceEpoch(reference.name, reference.epoch);
        const cxxrtlResponse = await this.connection!.queryInterval({
            type: 'command',
            command: 'query_interval',
            interval: interval.toCXXRTL(),
            collapse: true,
            items: reference.name,
            item_values_encoding: 'base64(u32)',
            diagnostics: false
        });
        return cxxrtlResponse.samples.map((cxxrtlSample) => {
            const itemValuesBuffer = Buffer.from(cxxrtlSample.item_values!, 'base64');
            const itemValuesArray = new Uint32Array(
                itemValuesBuffer.buffer,
                itemValuesBuffer.byteOffset,
                itemValuesBuffer.length / Uint32Array.BYTES_PER_ELEMENT
            );
            return new Sample(
                TimePoint.fromCXXRTL(cxxrtlSample.time),
                reference.unbound,
                itemValuesArray
            );
        });
    }
}
