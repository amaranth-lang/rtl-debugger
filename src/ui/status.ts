import * as vscode from 'vscode';
import { CXXRTLDebugger, CXXRTLSessionStatus } from '../debugger';
import { CXXRTLSimulationStatus } from '../connection';

export class StatusItemController {
    private statusItem: vscode.StatusBarItem;
    private subscriptions: vscode.Disposable[] = [];

    constructor(
        private rtlDebugger: CXXRTLDebugger
    ) {
        this.statusItem = vscode.window.createStatusBarItem('rtlDebugger', vscode.StatusBarAlignment.Left, 10);
        this.statusItem.tooltip = 'RTL Debugger Status';
        this.statusItem.command = 'rtlDebugger.runPauseSimulation';
        rtlDebugger.onDidChangeSessionStatus((_state) => this.update(), this.subscriptions);
        rtlDebugger.onDidChangeCurrentTime((_time) => this.update(), this.subscriptions);
        rtlDebugger.onDidChangeSimulationStatus((_state) => this.update(), this.subscriptions);
        rtlDebugger.onDidChangeLatestTime((_time) => this.update(), this.subscriptions);
    }

    dispose() {
        this.subscriptions.splice(0, this.subscriptions.length).forEach(sub => sub.dispose());
        this.statusItem.dispose();
    }

    private update() {
        if (this.rtlDebugger.sessionStatus === CXXRTLSessionStatus.Absent) {
            this.statusItem.hide();
        } else {
            this.statusItem.show();
            if (this.rtlDebugger.sessionStatus === CXXRTLSessionStatus.Starting) {
                this.statusItem.text = `$(gear~spin) Starting...`;
                this.statusItem.tooltip = `RTL Debugger: Starting`;
            } else { // this.sessionState === CXXRTLSessionState.Running
                if (this.rtlDebugger.simulationStatus === CXXRTLSimulationStatus.Running) {
                    this.statusItem.text = '$(debug-pause) ';
                    this.statusItem.tooltip = `RTL Debugger: Running`;
                } else if (this.rtlDebugger.simulationStatus === CXXRTLSimulationStatus.Paused) {
                    this.statusItem.text = '$(debug-continue) ';
                    this.statusItem.tooltip = `RTL Debugger: Paused`;
                } else if (this.rtlDebugger.simulationStatus === CXXRTLSimulationStatus.Finished) {
                    this.statusItem.text = '';
                    this.statusItem.tooltip = `RTL Debugger: Finished`;
                }
                this.statusItem.text += `${this.rtlDebugger.currentTime} / ${this.rtlDebugger.latestTime}`;
            }
        }
    }
};
