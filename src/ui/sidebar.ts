import * as vscode from 'vscode';
import { CXXRTLDebugger, CXXRTLSessionStatus } from '../debugger';
import { ModuleScope, Scope } from '../model/scope';
import { MemoryVariable, ScalarVariable, Variable } from '../model/variable';
import { DisplayStyle, variableDescription, variableBitIndices, memoryRowIndices } from '../model/styling';

function buildBooleanLikeTreeItem(name: string): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(name);
    treeItem.iconPath = new vscode.ThemeIcon('symbol-boolean');
    return treeItem;
}

function buildScalarLikeTreeItem(name: string): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.Collapsed);
    treeItem.iconPath = new vscode.ThemeIcon('symbol-variable');
    return treeItem;
}

function buildMemoryLikeTreeItem(name: string): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.Collapsed);
    treeItem.iconPath = new vscode.ThemeIcon('symbol-array');
    return treeItem;
}

abstract class TreeItem {
    constructor(
        readonly displayStyle: DisplayStyle,
    ) {}

    abstract getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;

    getChildren(): vscode.ProviderResult<TreeItem[]> {
        return [];
    }
}

class VariableTreeItem extends TreeItem {
    constructor(
        displayStyle: DisplayStyle,
        readonly variable: Variable,
    ) {
        super(displayStyle);
    }

    override getTreeItem(): vscode.TreeItem {
        let treeItem;
        if (this.variable instanceof ScalarVariable) {
            if (this.variable.width === 1) {
                treeItem = buildBooleanLikeTreeItem(this.variable.name);
            } else {
                treeItem = buildScalarLikeTreeItem(this.variable.name);
            }
        } else if (this.variable instanceof MemoryVariable) {
            treeItem = buildMemoryLikeTreeItem(this.variable.name);
        } else {
            throw new Error(`Unknown variable kind ${this.variable}`);
        }
        treeItem.description = variableDescription(this.displayStyle, this.variable);
        treeItem.tooltip = new vscode.MarkdownString(this.variable.fullName.join('.'));
        treeItem.tooltip.isTrusted = true;
        if (this.variable.location) {
            treeItem.tooltip.appendMarkdown(`\n\n- ${this.variable.location.asMarkdownLink()}`);
            treeItem.command = this.variable.location.asOpenCommand();
        }
        return treeItem;
    }

    override getChildren(): TreeItem[] {
        const children = [];
        if (this.variable instanceof ScalarVariable && this.variable.width > 1) {
            // TODO: Extremely big variables (>1000 bits?) need to be chunked into groups.
            for (const bitIndex of variableBitIndices(this.displayStyle, this.variable)) {
                children.push(new ScalarBitTreeItem(this.displayStyle, this.variable, bitIndex));
            }
        } else if (this.variable instanceof MemoryVariable) {
            // TODO: Big memories (>100 rows?) need to be chunked into groups.
            for (const rowIndex of memoryRowIndices(this.variable))  {
                children.push(new MemoryRowTreeItem(this.displayStyle, this.variable, rowIndex));
            }
        }
        return children;
    }
}

class ScalarBitTreeItem extends TreeItem {
    constructor(
        displayStyle: DisplayStyle,
        readonly variable: Variable,
        readonly bitIndex: number,
    ) {
        super(displayStyle);
    }

    override getTreeItem(): vscode.TreeItem {
        return buildBooleanLikeTreeItem(`${this.variable.name}[${this.bitIndex}]`);
    }
}

class MemoryRowTreeItem extends TreeItem {
    constructor(
        displayStyle: DisplayStyle,
        readonly variable: Variable,
        readonly rowIndex: number,
    ) {
        super(displayStyle);
    }

    override getTreeItem(): vscode.TreeItem {
        if (this.variable.width === 1) {
            return buildBooleanLikeTreeItem(`${this.variable.name}[${this.rowIndex}]`);
        } else {
            return buildScalarLikeTreeItem(`${this.variable.name}[${this.rowIndex}]`);
        }
    }

    override getChildren(): TreeItem[] {
        const children = [];
        if (this.variable.width > 1) {
            // TODO: Extremely big variables (>1000 bits?) need to be chunked into groups.
            for (const bitIndex of variableBitIndices(this.displayStyle, this.variable)) {
                children.push(new MemoryBitTreeItem(this.displayStyle, this.variable, this.rowIndex, bitIndex));
            }
        }
        return children;
    }
}

class MemoryBitTreeItem extends TreeItem {
    constructor(
        displayStyle: DisplayStyle,
        readonly variable: Variable,
        readonly rowIndex: number,
        readonly bitIndex: number,
    ) {
        super(displayStyle);
    }

    override getTreeItem(): vscode.TreeItem {
        return buildBooleanLikeTreeItem(`${this.variable.name}[${this.rowIndex}][${this.bitIndex}]`);
    }
}

class ScopeTreeItem extends TreeItem {
    constructor(
        displayStyle: DisplayStyle,
        readonly scope: Scope,
    ) {
        super(displayStyle);
    }

    override async getTreeItem(): Promise<vscode.TreeItem> {
        if (this.scope.name === '') {
            return new vscode.TreeItem('Hierarchy', vscode.TreeItemCollapsibleState.Expanded);
        } else {
            const treeItem = new vscode.TreeItem(this.scope.name);
            treeItem.iconPath = new vscode.ThemeIcon('symbol-module');
            if (this.scope instanceof ModuleScope) {
                treeItem.description = this.scope.moduleFullName.join('.');
            }
            treeItem.tooltip = new vscode.MarkdownString(this.scope.fullName.join('.'));
            treeItem.tooltip.isTrusted = true;
            if (this.scope.location) {
                treeItem.tooltip.appendMarkdown(`\n\n- ${this.scope.location.asMarkdownLink()}`);
                if (this.scope instanceof ModuleScope && this.scope.moduleLocation) {
                    treeItem.tooltip.appendMarkdown(`\n- ${this.scope.moduleLocation.asMarkdownLink()}`);
                }
                treeItem.command = this.scope.location.asOpenCommand();
            }
            if ((await this.scope.scopes).length > 0 || (await this.scope.variables).length > 0) {
                treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
            }
            return treeItem;
        }
    }

    override async getChildren(): Promise<TreeItem[]> {
        const children = [];
        for (const scope of await this.scope.scopes) {
            children.push(new ScopeTreeItem(this.displayStyle, scope));
        }
        for (const variable of await this.scope.variables) {
            children.push(new VariableTreeItem(this.displayStyle, variable));
        }
        return children;
    }
}

export class TreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | null> = new vscode.EventEmitter<TreeItem | null>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | null> = this._onDidChangeTreeData.event;

    constructor(
        readonly rtlDebugger: CXXRTLDebugger
    ) {
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('rtlDebugger.displayStyle')) {
                this._onDidChangeTreeData.fire(null);
            }
        });
        rtlDebugger.onDidChangeSessionStatus((_state) => {
            this._onDidChangeTreeData.fire(null);
        });
        rtlDebugger.onDidChangeCurrentTime((_time) => {
            this._onDidChangeTreeData.fire(null);
        });
    }

    getTreeItem(element: TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }

    async getChildren(element?: TreeItem): Promise<TreeItem[] | null | undefined> {
        if (this.rtlDebugger.sessionStatus !== CXXRTLSessionStatus.Running) {
            return [];
        } else if (element !== undefined) {
            return await element.getChildren();
        } else {
            const displayStyle = vscode.workspace.getConfiguration('rtlDebugger')
                .get('displayStyle') as DisplayStyle;
            const rootScope = await this.rtlDebugger.getRootScope();
            return [
                new ScopeTreeItem(displayStyle, rootScope),
            ];
        }
    }
}
