import * as vscode from 'vscode';
import { CXXRTLDebugger } from './debugger';
import { CXXRTLHierarchyTreeDataProvider } from './hierarchyTree';
import { CXXRTLVariableTreeDataProvider } from './variableTree';
import { CXXRTLSimulationStatus } from './connection';
import { TimePoint } from './time';

export function activate(context: vscode.ExtensionContext) {
    const cxxrtlDebugger = new CXXRTLDebugger();
    const cxxrtlHierarchyTreeDataProvider = new CXXRTLHierarchyTreeDataProvider(cxxrtlDebugger);
    const cxxrtlVariableTreeDataProvider = new CXXRTLVariableTreeDataProvider(cxxrtlDebugger);

    vscode.commands.executeCommand('setContext', 'cxxrtlDebugger.sessionStatus', cxxrtlDebugger.sessionStatus);
    context.subscriptions.push(cxxrtlDebugger.onDidChangeSessionStatus((state) =>
        vscode.commands.executeCommand('setContext', 'cxxrtlDebugger.sessionStatus', state)));

    vscode.commands.executeCommand('setContext', 'cxxrtlDebugger.simulationStatus', cxxrtlDebugger.simulationStatus);
    context.subscriptions.push(cxxrtlDebugger.onDidChangeSimulationStatus((state) =>
        vscode.commands.executeCommand('setContext', 'cxxrtlDebugger.simulationStatus', state)));

    context.subscriptions.push(vscode.commands.registerCommand('cxxrtlDebugger.startSession', () =>
        cxxrtlDebugger.startSession()));
    context.subscriptions.push(vscode.commands.registerCommand('cxxrtlDebugger.stopSession', () =>
        cxxrtlDebugger.stopSession()));
    context.subscriptions.push({ dispose: () => cxxrtlDebugger.stopSession() });

    context.subscriptions.push(vscode.commands.registerCommand('cxxrtlDebugger.runSimulation', () =>
        cxxrtlDebugger.runSimulation()));
    context.subscriptions.push(vscode.commands.registerCommand('cxxrtlDebugger.runSimulationUntil', () =>
        cxxrtlDebugger.runSimulationUntil()));
    context.subscriptions.push(vscode.commands.registerCommand('cxxrtlDebugger.pauseSimulation', () =>
        cxxrtlDebugger.pauseSimulation()));
    context.subscriptions.push(vscode.commands.registerCommand('cxxrtlDebugger.runPauseSimulation', () => {
        if (cxxrtlDebugger.simulationStatus === CXXRTLSimulationStatus.Running) {
            cxxrtlDebugger.pauseSimulation();
        } else {
            cxxrtlDebugger.runSimulation();
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('cxxrtlDebugger.stepBackward', () =>
        cxxrtlDebugger.stepBackward()));
    context.subscriptions.push(vscode.commands.registerCommand('cxxrtlDebugger.stepForward', () =>
        cxxrtlDebugger.stepForward()));

    const cxxrtlHierarchyTreeView = vscode.window.createTreeView('cxxrtlDebugger.hierarchy', {
        treeDataProvider: cxxrtlHierarchyTreeDataProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(cxxrtlHierarchyTreeView);

    const cxxrtlVariableTreeView = vscode.window.createTreeView('cxxrtlDebugger.variables', {
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
