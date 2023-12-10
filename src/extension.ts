import * as vscode from 'vscode';
import { CXXRTLDebugger } from './debugger';
import { CXXRTLHierarchyTreeDataProvider } from './hierarchyTree';
import { CXXRTLVariableTreeDataProvider } from './variableTree';

export function activate(context: vscode.ExtensionContext) {
    const cxxrtlDebugger = new CXXRTLDebugger();
    const cxxrtlHierarchyTreeDataProvider = new CXXRTLHierarchyTreeDataProvider(cxxrtlDebugger);
    const cxxrtlVariableTreeDataProvider = new CXXRTLVariableTreeDataProvider(cxxrtlDebugger);

    vscode.commands.executeCommand('setContext', 'cxxrtlDebugger.sessionState', cxxrtlDebugger.sessionState);
    context.subscriptions.push(cxxrtlDebugger.onDidChangeSessionState(
        (state) =>  vscode.commands.executeCommand('setContext', 'cxxrtlDebugger.sessionState', state)));

    vscode.commands.executeCommand('setContext', 'cxxrtlDebugger.simulationState', cxxrtlDebugger.simulationState);
    context.subscriptions.push(cxxrtlDebugger.onDidChangeSimulationState(
        (state) =>  vscode.commands.executeCommand('setContext', 'cxxrtlDebugger.simulationState', state)));

    context.subscriptions.push(vscode.commands.registerCommand('cxxrtlDebugger.startSession',
        () => cxxrtlDebugger.startSession()));
    context.subscriptions.push(vscode.commands.registerCommand('cxxrtlDebugger.stopSession',
        () => cxxrtlDebugger.stopSession()));
    context.subscriptions.push({ dispose: () => cxxrtlDebugger.stopSession() });

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
