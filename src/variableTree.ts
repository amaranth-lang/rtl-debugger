import * as vscode from 'vscode';
import { CXXRTLDebugger } from './debugger';
import { ICXXRTLDebugItem, ICXXRTLSourceLocation } from './connection';

export class CXXRTLVariableTreeItem extends vscode.TreeItem {
    private openCommandArguments(loc: ICXXRTLSourceLocation): [vscode.Uri, vscode.TextDocumentShowOptions] {
        const position = new vscode.Position(loc.startLine - 1, (loc.startColumn ?? 1) - 1);
        return [
            vscode.Uri.parse(loc.file),
            {
                selection: new vscode.Selection(position, position),
                preview: true,
                preserveFocus: false
            }
        ];
    }

    private openCommandUri(loc: ICXXRTLSourceLocation): vscode.Uri {
        const args = this.openCommandArguments(loc);
        return vscode.Uri.parse(`command:vscode.open?${encodeURIComponent(JSON.stringify(args))}`);
    }

    constructor(
        public readonly id: string,
        public readonly debugItem: ICXXRTLDebugItem
    ) {
        const label = id.substring(id.lastIndexOf(' '));
        super(label, vscode.TreeItemCollapsibleState.None);
        this.tooltip = new vscode.MarkdownString();
        this.tooltip.isTrusted = true;
        this.tooltip.appendMarkdown(`${id.split(' ').join('.')}\n\n`);
        for (const loc of this.debugItem.src) {
            const sourceRelativePath = vscode.workspace.asRelativePath(loc.file);
            this.tooltip.appendMarkdown(`- [${sourceRelativePath}:${loc.startLine}](${this.openCommandUri(loc)})`);
        }
        if (debugItem.type === 'node') {
            this.iconPath = new vscode.ThemeIcon('symbol-variable');
        }
        if (debugItem.type === 'memory') {
            this.iconPath = new vscode.ThemeIcon('symbol-array');
        }
        if (debugItem.width !== 1) {
            this.description = `[${debugItem.lsb_at}:${debugItem.lsb_at + debugItem.width}]`;
            if (debugItem.type === 'memory') {
                this.description += ` [${debugItem.zero_at}:${debugItem.zero_at + debugItem.depth}]`;
            }
        }
        if (this.debugItem.src.length > 0) {
            this.command = {
                title: "Reveal in Editor",
                command: 'vscode.open',
                arguments: this.openCommandArguments(this.debugItem.src[0])
            };
        }
    }
}

export class CXXRTLVariableTreeDataProvider implements vscode.TreeDataProvider<CXXRTLVariableTreeItem> {
    private _scope: string = "";
    public get scope() { return this._scope; }

    private _onDidChangeTreeData: vscode.EventEmitter<CXXRTLVariableTreeItem | null> = new vscode.EventEmitter<CXXRTLVariableTreeItem | null>();
    readonly onDidChangeTreeData: vscode.Event<CXXRTLVariableTreeItem | null> = this._onDidChangeTreeData.event;

    constructor(
        readonly cxxrtlDebugger: CXXRTLDebugger,
    ) {
        this.cxxrtlDebugger.onDidChangeSessionState((_state) => {
            this._onDidChangeTreeData.fire(null);
        });
    }

    public set scope(scope: string) {
        this._scope = scope;
        this._onDidChangeTreeData.fire(null);
    }

    private getVariablesIn(scope: string): Promise<Map<string, ICXXRTLDebugItem>> {
        return this.cxxrtlDebugger.listVariables(scope);
    }

    public getTreeItem(element: CXXRTLVariableTreeItem): vscode.TreeItem {
        return element;
    }

    public getChildren(element?: CXXRTLVariableTreeItem): vscode.ProviderResult<CXXRTLVariableTreeItem[]> {
        if (element) {
            // TODO: expand signals and memories
            return [];
        } else {
            return this.getVariablesIn(this.scope).then((variables) => {
                let elements: CXXRTLVariableTreeItem[] = [];
                for (let [id, description] of variables) {
                    elements.push(new CXXRTLVariableTreeItem(id, description));
                }
                return elements;
            });
        }
    }
}

