import * as vscode from 'vscode';
import { CXXRTLDebugger } from '../debugger';
import { Session } from '../debug/session';

export class StatusBarItem {
    private statusItem: vscode.StatusBarItem;

    constructor(rtlDebugger: CXXRTLDebugger) {
        this.statusItem = vscode.window.createStatusBarItem('rtlDebugger', vscode.StatusBarAlignment.Left, 10);
        this.statusItem.tooltip = 'RTL Debugger Status';
        this.statusItem.command = 'rtlDebugger.runPauseSimulation';
        rtlDebugger.onDidChangeSession((session) => {
            this.update(session);
            if (session !== null) {
                session.onDidChangeSimulationStatus((_status) => this.update(session));
                session.onDidChangeTimeCursor((_time) => this.update(session));
            }
        });
    }

    dispose() {
        this.statusItem.dispose();
    }

    private update(session: Session | null) {
        if (session === null) {
            this.statusItem.hide();
        } else {
            this.statusItem.show();
            if (session.simulationStatus.status === 'running') {
                this.statusItem.text = '$(debug-pause) ';
                this.statusItem.tooltip = 'RTL Debugger: Running';
            } else if (session.simulationStatus.status === 'paused') {
                this.statusItem.text = '$(debug-continue) ';
                this.statusItem.tooltip = 'RTL Debugger: Paused';
            } else if (session.simulationStatus.status === 'finished') {
                this.statusItem.text = '';
                this.statusItem.tooltip = 'RTL Debugger: Finished';
            }
            this.statusItem.text += `${session.timeCursor} / ${session.simulationStatus.latestTime}`;
        }
    }
}
