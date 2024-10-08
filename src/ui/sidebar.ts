import * as vscode from 'vscode';

import { ModuleScope, Scope } from '../model/scope';
import { MemoryVariable, ScalarVariable, Variable } from '../model/variable';
import { DisplayStyle, variableDescription, variableBitIndices, memoryRowIndices, variableValue, variableTooltip } from '../model/styling';
import { CXXRTLDebugger, CXXRTLSessionStatus } from '../debugger';
import { Observer } from '../observer';
import { Designation, MemoryRangeDesignation, MemoryRowDesignation, ScalarDesignation } from '../model/sample';

abstract class TreeItem {
    constructor(
        readonly provider: TreeDataProvider
    ) {}

    abstract getTreeItem(): vscode.TreeItem | Thenable<vscode.TreeItem>;

    getChildren(): vscode.ProviderResult<TreeItem[]> {
        return [];
    }

    get displayStyle(): DisplayStyle {
        return this.provider.displayStyle;
    }

    getValue<T>(designation: Designation<T>): T | undefined {
        return this.provider.getValue(this, designation);
    }
}

class BitTreeItem extends TreeItem {
    constructor(
        provider: TreeDataProvider,
        readonly designation: ScalarDesignation | MemoryRowDesignation,
        readonly bitIndex: number,
    ) {
        super(provider);
    }

    get variable(): Variable {
        return this.designation.variable;
    }

    override getTreeItem(): vscode.TreeItem {
        const variable = this.designation.variable;
        const treeItem = new vscode.TreeItem(variable.name);
        if (this.designation instanceof MemoryRowDesignation) {
            treeItem.label += `[${this.designation.index}]`;
        }
        treeItem.label += `[${this.bitIndex}]`;
        treeItem.iconPath = new vscode.ThemeIcon('symbol-boolean');
        const value = this.getValue(this.designation);
        if (value === undefined) {
            treeItem.description = '= ...';
        } else {
            treeItem.description = ((value & (1n << BigInt(this.bitIndex))) !== 0n)
                ? '= 1'
                : '= 0';
        }
        treeItem.tooltip = variableTooltip(variable);
        return treeItem;
    }
}

class ScalarTreeItem extends TreeItem {
    constructor(
        provider: TreeDataProvider,
        readonly designation: ScalarDesignation | MemoryRowDesignation,
    ) {
        super(provider);
    }

    override getTreeItem(): vscode.TreeItem {
        const variable = this.designation.variable;
        const treeItem = new vscode.TreeItem(variable.name);
        if (this.designation instanceof MemoryRowDesignation) {
            treeItem.label += `[${this.designation.index}]`;
        }
        if (variable.width > 1) {
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        }
        treeItem.iconPath = (variable.width === 1)
            ? new vscode.ThemeIcon('symbol-boolean')
            : new vscode.ThemeIcon('symbol-variable');
        const value = this.getValue(this.designation);
        treeItem.description = variableDescription(this.displayStyle, variable, { scalar: true });
        treeItem.description += (treeItem.description !== '') ? ' = ' : '= ';
        treeItem.description += variableValue(this.displayStyle, variable, value);
        treeItem.tooltip = variableTooltip(variable);
        treeItem.command = variable.location?.asOpenCommand();
        return treeItem;
    }

    override getChildren(): TreeItem[] {
        const variable = this.designation.variable;
        return Array.from(variableBitIndices(this.displayStyle, variable)).map((index) =>
            new BitTreeItem(this.provider, this.designation, index));
    }
}

class ArrayTreeItem extends TreeItem {
    constructor(
        provider: TreeDataProvider,
        readonly designation: MemoryRangeDesignation,
    ) {
        super(provider);
    }

    override getTreeItem(): vscode.TreeItem {
        const variable = this.designation.variable;
        const treeItem = new vscode.TreeItem(variable.name);
        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        treeItem.iconPath = new vscode.ThemeIcon('symbol-array');
        treeItem.description = variableDescription(this.displayStyle, variable);
        treeItem.tooltip = variableTooltip(variable);
        treeItem.command = variable.location?.asOpenCommand();
        return treeItem;
    }

    override getChildren(): TreeItem[] {
        const variable = this.designation.variable;
        return Array.from(memoryRowIndices(variable)).map((index) =>
            new ScalarTreeItem(this.provider, variable.designation(index)));
    }
}

class ScopeTreeItem extends TreeItem {
    constructor(
        provider: TreeDataProvider,
        readonly scope: Scope,
    ) {
        super(provider);
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
            children.push(new ScopeTreeItem(this.provider, scope));
        }
        for (const variable of await this.scope.variables) {
            if (variable instanceof ScalarVariable) {
                children.push(new ScalarTreeItem(this.provider, variable.designation()));
            }
            if (variable instanceof MemoryVariable) {
                children.push(new ArrayTreeItem(this.provider, variable.designation()));
            }
        }
        return children;
    }
}

export class TreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | null> = new vscode.EventEmitter<TreeItem | null>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | null> = this._onDidChangeTreeData.event;

    private rtlDebugger: CXXRTLDebugger;
    private observer: Observer;

    constructor(rtlDebugger: CXXRTLDebugger) {
        this.rtlDebugger = rtlDebugger;
        this.observer = new Observer(rtlDebugger, 'sidebar');

        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('rtlDebugger.displayStyle')) {
                this._onDidChangeTreeData.fire(null);
            }
        });
        rtlDebugger.onDidChangeSessionStatus((_state) =>
            this._onDidChangeTreeData.fire(null));
    }

    getTreeItem(element: TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }

    async getChildren(element?: TreeItem): Promise<TreeItem[] | null | undefined> {
        if (element !== undefined) {
            return await element.getChildren();
        } else {
            if (this.rtlDebugger.sessionStatus === CXXRTLSessionStatus.Running) {
                return [
                    new ScopeTreeItem(this, await this.rtlDebugger.getRootScope()),
                ];
            } else {
                return [];
            }
        }
    }

    get displayStyle(): DisplayStyle {
        const displayStyle = vscode.workspace.getConfiguration('rtlDebugger').get('displayStyle');
        return displayStyle as DisplayStyle;
    }

    getValue<T>(element: TreeItem, designation: Designation<T>): T | undefined {
        this.observer.observe(designation, (_value) => {
            this._onDidChangeTreeData.fire(element);
            return false; // one-shot
        });
        return this.observer.query(designation);
    }
}
