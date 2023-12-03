import * as net from 'net';
import * as vscode from 'vscode';
import { CXXRTLConnection, ICXXRTLDebugItem } from './connection';

export enum CXXRTLSessionState {
    Absent = "absent",
    Starting = "starting",
    Running = "running",
}

export enum CXXRTLSimulationState {
    Stopped = "stopped",
    Running = "running",
}

export class CXXRTLDebugger {
    private terminal: vscode.Terminal | null = null;

    private connection: CXXRTLConnection | null = null;

    private _sessionState: CXXRTLSessionState = CXXRTLSessionState.Absent;
    public get sessionState() { return this._sessionState;}
    private _onDidChangeSessionState: vscode.EventEmitter<CXXRTLSessionState> = new vscode.EventEmitter<CXXRTLSessionState>();
    readonly onDidChangeSessionState: vscode.Event<CXXRTLSessionState> = this._onDidChangeSessionState.event;

    private _simulationState: CXXRTLSimulationState = CXXRTLSimulationState.Stopped;
    public get simulationState() { return this._simulationState; }
    private _onDidChangeSimulationState: vscode.EventEmitter<CXXRTLSimulationState> = new vscode.EventEmitter<CXXRTLSimulationState>();
    readonly onDidChangeSimulationState: vscode.Event<CXXRTLSimulationState> = this._onDidChangeSimulationState.event;

    private _scopes: string[] = [];
    public get scopes() { return this._scopes; }

    public async startSession(): Promise<void> {
        if (this.terminal !== null) {
            vscode.window.showErrorMessage("A debug session is already in the process of being started.");
            return;
        }

        const configuration = this.workspaceConfiguration();
        if (configuration.command.length !== 0) {
            this.terminal = vscode.window.createTerminal({
                name: "CXXRTL Simulation",
                shellPath: configuration.command[0],
                shellArgs: configuration.command.slice(1),
                isTransient: true,
                iconPath: new vscode.ThemeIcon('debug-console')
            });
            this.setSessionState(CXXRTLSessionState.Starting);

            const processId = await this.terminal.processId;
            console.log("[CXXRTL Debugger] Launched process %d", processId);

            setTimeout(() => {
                const socket = net.createConnection({ port: configuration.port, host: '::1' }, () => {
                    vscode.window.showInformationMessage("Connected to the CXXRTL agent.");

                    (async () => {
                        this.connection = new CXXRTLConnection(socket,
                            (agentError) => {
                                vscode.window.showErrorMessage(`The CXXRTL agent has returned an error: ${agentError.message}`);
                            },
                            (clientError) => {
                                vscode.window.showErrorMessage(`The CXXRTL debugger has encountered an error: ${clientError.message}`);
                            });

                        const _capabilities = await this.connection.exchangeGreeting();
                        const scopes = await this.connection.listScopes();
                        console.log("[CXXRTL Debugger] Initialized");

                        this.setSessionState(CXXRTLSessionState.Running);
                        this._scopes = scopes;
                    })().catch(() => {
                        this.stopSession();
                    });
                });
                socket.on('error', (err: any) => {
                    if (err.code === 'ECONNREFUSED') {
                        vscode.window.showErrorMessage("The connection to the CXXRTL agent was refused.");
                    } else {
                        vscode.window.showErrorMessage(`The connection to the CXXRTL agent has failed: ${err.code}.`);
                    }
                    this.stopSession();
                });
                socket.on('close', () => {
                    vscode.window.showInformationMessage("Disconnected from the CXXRTL agent.");

                    this.stopSession();
                });
            }, 500); // FIXME
        } else {
            const OpenSettings = "Open Settings";
            const selection = await vscode.window.showErrorMessage("Configure the launch command to start a debug session.", OpenSettings);
            if (selection === OpenSettings) {
                vscode.commands.executeCommand('workbench.action.openSettings', 'cxxrtlDebugger.command');
            }
        }
    }

    public stopSession() {
        this.terminal?.dispose();
        this.terminal = null;

        this.connection?.dispose();
        this.connection = null;

        this.setSessionState(CXXRTLSessionState.Absent);
        this.setSimulationState(CXXRTLSimulationState.Stopped);
        this._scopes = [];
    }

    public async listVariables(scope: string): Promise<Map<string, ICXXRTLDebugItem>> {
        if (!this.connection) {
            return new Map();
        }
        return await this.connection.listItems(scope);
    }

    private workspaceConfiguration(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration('cxxrtlDebugger');
    }

    private setSessionState(sessionState: CXXRTLSessionState): void {
        if (this._sessionState !== sessionState) {
            this._sessionState = sessionState;
            this._onDidChangeSessionState.fire(this.sessionState);
        }
    }

    private setSimulationState(simulationState: CXXRTLSimulationState): void {
        if (this._simulationState !== simulationState) {
            this._simulationState = simulationState;
            this._onDidChangeSimulationState.fire(this.simulationState);
        }
    }
}
