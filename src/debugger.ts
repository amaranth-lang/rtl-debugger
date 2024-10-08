import * as net from 'net';
import * as vscode from 'vscode';
import { NodeStreamLink } from './cxxrtl/link';
import { StatusBarItem } from './ui/status';
import { Session } from './debug/session';

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
    public session: Session | null = null;

    // Session properties.

    private _onDidChangeSession: vscode.EventEmitter<Session | null> = new vscode.EventEmitter<Session | null>();
    readonly onDidChangeSession: vscode.Event<Session | null> = this._onDidChangeSession.event;

    private _sessionStatus: CXXRTLSessionStatus = CXXRTLSessionStatus.Absent;
    public get sessionStatus() {
        return this._sessionStatus;
    }
    private _onDidChangeSessionStatus: vscode.EventEmitter<CXXRTLSessionStatus> = new vscode.EventEmitter<CXXRTLSessionStatus>();
    readonly onDidChangeSessionStatus: vscode.Event<CXXRTLSessionStatus> = this._onDidChangeSessionStatus.event;

    // Simulation properties.

    private _simulationStatus: CXXRTLSimulationStatus = CXXRTLSimulationStatus.Finished;
    public get simulationStatus() {
        return this._simulationStatus;
    }
    private _onDidChangeSimulationStatus: vscode.EventEmitter<CXXRTLSimulationStatus> = new vscode.EventEmitter<CXXRTLSimulationStatus>();
    readonly onDidChangeSimulationStatus: vscode.Event<CXXRTLSimulationStatus> = this._onDidChangeSimulationStatus.event;

    constructor() {
        this.statusBarItem = new StatusBarItem(this);
    }

    public dispose() {
        this.statusBarItem.dispose();
        this._onDidChangeSimulationStatus.dispose();
    }

    public async startSession(): Promise<void> {
        if (this.terminal !== null) {
            vscode.window.showErrorMessage('A debug session is already in the process of being started.');
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
            console.log('[RTL Debugger] Launched process %d', processId);

            setTimeout(() => {
                const socket = net.createConnection({ port: configuration.port, host: '::1' }, () => {
                    vscode.window.showInformationMessage('Connected to the CXXRTL server.');

                    (async () => {
                        this.session = new Session(new NodeStreamLink(socket));
                        this.session.onDidChangeSimulationStatus((status) => {
                            this.setSimulationStatus(status.status as CXXRTLSimulationStatus);
                        });
                        this.setSessionStatus(CXXRTLSessionStatus.Running);
                        this._onDidChangeSession.fire(this.session);
                        this.setSimulationStatus(
                            this.session.simulationStatus.status as CXXRTLSimulationStatus
                        );
                        console.log('[RTL Debugger] Initialized');
                    })().catch(() => {
                        this.stopSession();
                    });
                });
                socket.on('error', (err: any) => {
                    if (err.code === 'ECONNREFUSED') {
                        vscode.window.showErrorMessage('The connection to the CXXRTL server was refused.');
                    } else {
                        vscode.window.showErrorMessage(`The connection to the CXXRTL server has failed: ${err.code}.`);
                    }
                    this.stopSession();
                });
                socket.on('close', (hadError) => {
                    if (!hadError) {
                        vscode.window.showInformationMessage('Disconnected from the CXXRTL server.');
                    }
                    this.stopSession();
                });
            }, 500); // FIXME
        } else {
            const OpenSettings = 'Open Settings';
            const selection = await vscode.window.showErrorMessage('Configure the launch command to start a debug session.', OpenSettings);
            if (selection === OpenSettings) {
                vscode.commands.executeCommand('workbench.action.openSettings', 'rtlDebugger.command');
            }
        }
    }

    public stopSession() {
        this._onDidChangeSession.fire(null);

        this.terminal?.dispose();
        this.terminal = null;

        this.session?.dispose();
        this.session = null;

        this.setSessionStatus(CXXRTLSessionStatus.Absent);
        this.setSimulationStatus(CXXRTLSimulationStatus.Finished);
    }

    private setSessionStatus(sessionState: CXXRTLSessionStatus): void {
        if (this._sessionStatus !== sessionState) {
            this._sessionStatus = sessionState;
            this._onDidChangeSessionStatus.fire(sessionState);
        }
    }

    private setSimulationStatus(simulationState: CXXRTLSimulationStatus): void {
        if (this._simulationStatus !== simulationState) {
            this._simulationStatus = simulationState;
            this._onDidChangeSimulationStatus.fire(simulationState);
        }
    }
}
