import * as vscode from 'vscode';
import { CXXRTLDebugger, CXXRTLSimulationStatus } from './debugger';
import * as sidebar from './ui/sidebar';

export function activate(context: vscode.ExtensionContext) {
    const rtlDebugger = new CXXRTLDebugger();
    const sidebarTreeDataProvider = new sidebar.TreeDataProvider(rtlDebugger);

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
        rtlDebugger.runSimulation()));
    context.subscriptions.push(vscode.commands.registerCommand('rtlDebugger.runSimulationUntil', () =>
        rtlDebugger.runSimulationUntil()));
    context.subscriptions.push(vscode.commands.registerCommand('rtlDebugger.pauseSimulation', () =>
        rtlDebugger.pauseSimulation()));
    context.subscriptions.push(vscode.commands.registerCommand('rtlDebugger.runPauseSimulation', () => {
        if (rtlDebugger.simulationStatus === CXXRTLSimulationStatus.Running) {
            rtlDebugger.pauseSimulation();
        } else {
            rtlDebugger.runSimulation();
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('rtlDebugger.stepBackward', () =>
        rtlDebugger.stepBackward()));
    context.subscriptions.push(vscode.commands.registerCommand('rtlDebugger.stepForward', () =>
        rtlDebugger.stepForward()));

    // For an unknown reason, the `vscode.open` command (which does the exact same thing) ignores the options.
    context.subscriptions.push(vscode.commands.registerCommand('rtlDebugger.openDocument',
        (uri: vscode.Uri, options: vscode.TextDocumentShowOptions) => {
            vscode.window.showTextDocument(uri, options);
        }));

    const cxxrtlSidebarTreeView = vscode.window.createTreeView('rtlDebugger.sidebar', {
        treeDataProvider: sidebarTreeDataProvider
    });
    context.subscriptions.push(cxxrtlSidebarTreeView);
}
