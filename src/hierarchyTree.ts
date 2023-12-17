import * as vscode from 'vscode';
import { CXXRTLDebugger } from './debugger';

export class CXXRTLHierarchyTreeItem extends vscode.TreeItem {
    public override id: string;

    constructor(id: string, collapsibleState: vscode.TreeItemCollapsibleState) {
        const label = id.substring(id.lastIndexOf(' ') + 1);
        super(label, collapsibleState);
        this.id = id;
        this.tooltip = id.split(' ').join('.');
        this.iconPath = new vscode.ThemeIcon("symbol-module");
    }
}

export class CXXRTLHierarchyTreeDataProvider implements vscode.TreeDataProvider<CXXRTLHierarchyTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<CXXRTLHierarchyTreeItem | null> = new vscode.EventEmitter<CXXRTLHierarchyTreeItem | null>();
    readonly onDidChangeTreeData: vscode.Event<CXXRTLHierarchyTreeItem | null> = this._onDidChangeTreeData.event;

    constructor(
        readonly cxxrtlDebugger: CXXRTLDebugger
    ) {
        cxxrtlDebugger.onDidChangeSessionStatus((_state) => {
            this._onDidChangeTreeData.fire(null);
        });
    }

    private getScopesIn(parentScope: string): string[] {
        if (parentScope === '') {
            return this.cxxrtlDebugger.scopes.filter((scope) => {
                return scope !== '' && scope.indexOf(' ') === -1;
            });
        } else {
            return this.cxxrtlDebugger.scopes.filter((scope) => {
                return scope.substring(0, scope.lastIndexOf(' ')) === parentScope;
            });
        }
    }

    public getTreeItem(element: CXXRTLHierarchyTreeItem): vscode.TreeItem {
        return element;
    }

    public getChildren(element?: CXXRTLHierarchyTreeItem): vscode.ProviderResult<CXXRTLHierarchyTreeItem[]> {
        return this.getScopesIn(element?.id ?? '').map((scope) => {
            const collapsibleState = this.getScopesIn(scope).length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;
            return new CXXRTLHierarchyTreeItem(scope, collapsibleState);
        });
    }
}

