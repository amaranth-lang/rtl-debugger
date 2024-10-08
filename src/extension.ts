import * as vscode from 'vscode';
import { CXXRTLDebugger } from './debugger';
import * as sidebar from './ui/sidebar';
import { inputTime } from './ui/input';

export function activate(context: vscode.ExtensionContext) {
    const rtlDebugger = new CXXRTLDebugger();
    const sidebarTreeDataProvider = new sidebar.TreeDataProvider(rtlDebugger);

    context.subscriptions.push(vscode.window.createTreeView('rtlDebugger.sidebar', {
        treeDataProvider: sidebarTreeDataProvider
    }));

    vscode.commands.executeCommand('setContext', 'rtlDebugger.sessionStatus', rtlDebugger.sessionStatus);
    context.subscriptions.push(rtlDebugger.onDidChangeSessionStatus((state) =>
        vscode.commands.executeCommand('setContext', 'rtlDebugger.sessionStatus', state)));

    vscode.commands.executeCommand('setContext', 'rtlDebugger.simulationStatus', rtlDebugger.simulationStatus);
    context.subscriptions.push(rtlDebugger.onDidChangeSimulationStatus((state) =>
        vscode.commands.executeCommand('setContext', 'rtlDebugger.simulationStatus', state)));

    context.subscriptions.push(vscode.commands.registerCommand('rtlDebugger.startSession', () =>
        rtlDebugger.startSession()));
    context.subscriptions.push(vscode.commands.registerCommand('rtlDebugger.stopSession', () =>
        rtlDebugger.stopSession()));
    context.subscriptions.push({ dispose: () => rtlDebugger.stopSession() });

    context.subscriptions.push(vscode.commands.registerCommand('rtlDebugger.runSimulation', () =>
        rtlDebugger.session!.runSimulation()));
    context.subscriptions.push(vscode.commands.registerCommand('rtlDebugger.pauseSimulation', () =>
        rtlDebugger.session!.pauseSimulation()));
    context.subscriptions.push(vscode.commands.registerCommand('rtlDebugger.runPauseSimulation', () => {
        if (rtlDebugger.session!.isSimulationRunning) {
            rtlDebugger.session!.pauseSimulation();
        } else {
            rtlDebugger.session!.runSimulation();
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('rtlDebugger.runSimulationUntil', () => {
        inputTime({ prompt: 'Enter the requested simulation time.' }).then((untilTime) => {
            if (untilTime !== undefined) {
                rtlDebugger.session!.runSimulation({ untilTime });
            }
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('rtlDebugger.stepBackward', () =>
        rtlDebugger.session!.stepBackward()));
    context.subscriptions.push(vscode.commands.registerCommand('rtlDebugger.stepForward', () =>
        rtlDebugger.session!.stepForward()));

    // For an unknown reason, the `vscode.open` command (which does the exact same thing) ignores the options.
    context.subscriptions.push(vscode.commands.registerCommand('rtlDebugger.openDocument',
        (uri: vscode.Uri, options: vscode.TextDocumentShowOptions) => {
            vscode.window.showTextDocument(uri, options);
        }));
}
