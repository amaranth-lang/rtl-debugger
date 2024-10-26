import * as vscode from 'vscode';

import { ModuleScope, Scope } from '../model/scope';
import { MemoryVariable, ScalarVariable, Variable } from '../model/variable';
import { DisplayStyle, variableDescription, variableBitIndices, memoryRowIndices, variableValue, variableTooltip } from '../model/styling';
import { CXXRTLDebugger } from '../debugger';
import { Observer } from '../debug/observer';
import { Designation, MemoryRangeDesignation, MemoryRowDesignation, ScalarDesignation } from '../model/sample';
import { IWatchItem, globalWatchList } from '../debug/watch';
import { Session } from '../debug/session';

abstract class TreeItem {
    // Currently used only for removing watch items, where knowing the index is necessary.
    metadata: any;

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
        readonly contextValue: string = '',
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
        treeItem.contextValue = this.contextValue;
        return treeItem;
    }

    getWatchItem(): IWatchItem {
        return {
            id: this.designation.variable.cxxrtlIdentifier,
            row: (this.designation instanceof MemoryRowDesignation)
                ? this.designation.index : undefined,
            bit: this.bitIndex,
        };
    }
}

class ScalarTreeItem extends TreeItem {
    constructor(
        provider: TreeDataProvider,
        readonly designation: ScalarDesignation | MemoryRowDesignation,
        readonly contextValue: string = '',
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
        treeItem.contextValue = this.contextValue;
        return treeItem;
    }

    override getChildren(): TreeItem[] {
        const variable = this.designation.variable;
        return Array.from(variableBitIndices(this.displayStyle, variable)).map((index) =>
            new BitTreeItem(this.provider, this.designation, index, 'canWatch'));
    }

    getWatchItem(): IWatchItem {
        return {
            id: this.designation.variable.cxxrtlIdentifier,
            row: (this.designation instanceof MemoryRowDesignation)
                ? this.designation.index : undefined,
        };
    }
}

class ArrayTreeItem extends TreeItem {
    constructor(
        provider: TreeDataProvider,
        readonly designation: MemoryRangeDesignation,
        readonly contextValue: string = '',
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
        treeItem.contextValue = this.contextValue;
        return treeItem;
    }

    override getChildren(): TreeItem[] {
        const variable = this.designation.variable;
        return Array.from(memoryRowIndices(variable)).map((index) =>
            new ScalarTreeItem(this.provider, variable.designation(index), 'canWatch'));
    }

    getWatchItem(): IWatchItem {
        return {
            id: this.designation.variable.cxxrtlIdentifier
        };
    }
}

class ScopeTreeItem extends TreeItem {
    constructor(
        provider: TreeDataProvider,
        readonly scope: Scope,
        readonly hasSiblings: boolean,
    ) {
        super(provider);
    }

    override async getTreeItem(): Promise<vscode.TreeItem> {
        if (this.scope.name === '') {
            return new vscode.TreeItem('ʜɪᴇʀᴀʀᴄʜʏ', vscode.TreeItemCollapsibleState.Expanded);
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
            const [subScopes, variables] = await Promise.all([this.scope.scopes, this.scope.variables]);
            if (subScopes.length > 0 || variables.length > 0) {
                treeItem.collapsibleState = this.hasSiblings ?
                    vscode.TreeItemCollapsibleState.Collapsed :
                    vscode.TreeItemCollapsibleState.Expanded;
            }
            return treeItem;
        }
    }

    override async getChildren(): Promise<TreeItem[]> {
        const [subScopes, variables] = await Promise.all([this.scope.scopes, this.scope.variables]);
        const children = [];
        for (const scope of subScopes) {
            children.push(new ScopeTreeItem(this.provider, scope, subScopes.length > 1));
        }
        for (const variable of variables) {
            if (variable instanceof ScalarVariable) {
                children.push(new ScalarTreeItem(this.provider, variable.designation(),
                    variable.width > 1 ? 'canWatch|canSetRadix' : 'canWatch'));
            }
            if (variable instanceof MemoryVariable) {
                children.push(new ArrayTreeItem(this.provider, variable.designation(), 'canWatch|canSetRadix'));
            }
        }
        return children;
    }
}

class WatchTreeItem extends TreeItem {
    constructor(
        provider: TreeDataProvider
    ) {
        super(provider);
    }

    override async getTreeItem(): Promise<vscode.TreeItem> {
        if (globalWatchList.get().length > 0) {
            return new vscode.TreeItem('ᴡᴀᴛᴄʜ', vscode.TreeItemCollapsibleState.Expanded);
        } else {
            return new vscode.TreeItem('ᴡᴀᴛᴄʜ (empty)');
        }
    }

    override async getChildren(): Promise<TreeItem[]> {
        const children = [];
        for (const [index, watchItem] of globalWatchList.get().entries()) {
            const variable = await this.provider.getVariable(watchItem.id);
            if (variable === null) {
                continue;
            }
            let designation;
            if (variable instanceof ScalarVariable) {
                designation = variable.designation();
            } else if (variable instanceof MemoryVariable) {
                if (watchItem.row === undefined) {
                    designation = variable.designation();
                } else {
                    designation = variable.designation(watchItem.row);
                }
            }
            let treeItem;
            if (designation instanceof MemoryRangeDesignation) {
                treeItem = new ArrayTreeItem(this.provider, designation, 'inWatchList|canSetRadix');
            } else if (designation instanceof ScalarDesignation || designation instanceof MemoryRowDesignation) {
                if (watchItem.bit === undefined) {
                    treeItem = new ScalarTreeItem(this.provider, designation,
                        designation.variable.width > 1 ? 'inWatchList|canSetRadix' : 'inWatchList');
                } else {
                    treeItem = new BitTreeItem(this.provider, designation, watchItem.bit, 'inWatchList');
                }
            }
            if (treeItem !== undefined) {
                treeItem.metadata = { index };
                children.push(treeItem);
            }
        }
        return children;
    }
}

export class TreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | null> = new vscode.EventEmitter<TreeItem | null>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | null> = this._onDidChangeTreeData.event;

    private session: Session | null = null;
    private observer: Observer | null = null;
    private watchTreeItem: WatchTreeItem | null = null;
    private scopeTreeItem: ScopeTreeItem | null = null;

    constructor(rtlDebugger: CXXRTLDebugger) {
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('rtlDebugger.displayStyle') ||
                    event.affectsConfiguration('rtlDebugger.variableOptions')) {
                this._onDidChangeTreeData.fire(null);
            }
        });
        rtlDebugger.onDidChangeSession(async (session) => {
            this.session = session;
            if (session !== null) {
                this.observer = new Observer(session, 'sidebar');
                this.watchTreeItem = new WatchTreeItem(this);
                this.scopeTreeItem = new ScopeTreeItem(this, await session.getRootScope(), false);
            } else {
                this.observer?.dispose();
                this.observer = null;
                this.watchTreeItem = null;
                this.scopeTreeItem = null;
            }
            this._onDidChangeTreeData.fire(null);
        });
        globalWatchList.onDidChange((_items) => {
            if (this.watchTreeItem !== null) {
                this._onDidChangeTreeData.fire(this.watchTreeItem);
            }
        });
    }

    getTreeItem(element: TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }

    async getChildren(element?: TreeItem): Promise<TreeItem[] | null | undefined> {
        if (element !== undefined) {
            return await element.getChildren();
        }
        const children = [];
        if (this.watchTreeItem !== null) {
            children.push(this.watchTreeItem);
        }
        if (this.scopeTreeItem !== null) {
            children.push(this.scopeTreeItem);
        }
        return children;
    }

    get displayStyle(): DisplayStyle {
        const displayStyle = vscode.workspace.getConfiguration('rtlDebugger').get('displayStyle');
        return displayStyle as DisplayStyle;
    }

    getVariable(identifier: string): Promise<Variable | null> {
        return this.session!.getVariable(identifier);
    }

    getValue<T>(element: TreeItem, designation: Designation<T>): T | undefined {
        if (this.observer === null) {
            return;
        }
        this.observer.observe(designation, (_value) => {
            this._onDidChangeTreeData.fire(element);
            return false; // one-shot
        });
        return this.observer.query(designation);
    }
}
