import * as vscode from 'vscode';
import { CXXRTLDebugger } from './debugger';
import { CXXRTLHierarchyTreeDataProvider } from './hierarchyTree';
import { CXXRTLVariableTreeDataProvider } from './variableTree';
import { CXXRTLSimulationStatus } from './connection';

export function activate(context: vscode.ExtensionContext) {
    const rtlDebugger = new CXXRTLDebugger();
    const cxxrtlHierarchyTreeDataProvider = new CXXRTLHierarchyTreeDataProvider(rtlDebugger);
    const cxxrtlVariableTreeDataProvider = new CXXRTLVariableTreeDataProvider(rtlDebugger);

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

    const cxxrtlHierarchyTreeView = vscode.window.createTreeView('rtlDebugger.hierarchy', {
        treeDataProvider: cxxrtlHierarchyTreeDataProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(cxxrtlHierarchyTreeView);

    const cxxrtlVariableTreeView = vscode.window.createTreeView('rtlDebugger.variables', {
        treeDataProvider: cxxrtlVariableTreeDataProvider,
        canSelectMany: true
    });
    context.subscriptions.push(cxxrtlVariableTreeView);

    context.subscriptions.push(cxxrtlHierarchyTreeView.onDidChangeSelection((event) => {
        if (event.selection.length !== 0) {
            cxxrtlVariableTreeDataProvider.scope = event.selection[0].id;
        } else {
            cxxrtlVariableTreeDataProvider.scope = '';
        }
        // UPSTREAM: It's not currently possible to un-select elements in a contributed tree. See microsoft/vscode#48754.
        // cxxrtlVariableTreeView.unSelect();
    }));
}
