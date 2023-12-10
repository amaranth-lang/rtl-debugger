import * as vscode from 'vscode';
import { CXXRTLDebugger } from './debugger';
import { ICXXRTLDebugItem, ICXXRTLSourceLocation } from './connection';

export class CXXRTLVariableTreeItem extends vscode.TreeItem {
    public override id: string;

    constructor(id: string, debugItem: ICXXRTLDebugItem) {
        const label = id.substring(id.lastIndexOf(' ') + 1);
        super(label, vscode.TreeItemCollapsibleState.None);
        this.id = id;
        this.tooltip = new vscode.MarkdownString();
        this.tooltip.isTrusted = true;
        this.tooltip.appendMarkdown(`${id.split(' ').join('.')}\n\n`);
        for (const loc of debugItem.src) {
            const sourceRelativePath = vscode.workspace.asRelativePath(loc.file);
            this.tooltip.appendMarkdown(`- [${sourceRelativePath}:${loc.startLine}](${this.openCommandUri(loc)})`);
        }
        switch (debugItem.type) {
        case 'node':
            this.iconPath = new vscode.ThemeIcon('symbol-variable');
            break;
        case 'memory':
            this.iconPath = new vscode.ThemeIcon('symbol-array');
            break;
        }
        if (debugItem.width !== 1) {
            const configuration = vscode.workspace.getConfiguration('cxxrtlDebugger');
            this.description = "";
            switch (configuration.rangeStyle) {
            case 'Verilog/VHDL':
                this.description += `[${debugItem.lsb_at + debugItem.width - 1}:${debugItem.lsb_at}]`;
                if (debugItem.type === 'memory') {
                    this.description += ` [${debugItem.zero_at}:${debugItem.zero_at + debugItem.depth - 1}]`;
                }
                break;
            case 'Python':
                if (debugItem.type === 'memory') {
                    if (debugItem.zero_at === 0) {
                        this.description += `[${debugItem.depth}] `;
                    } else {
                        this.description += `[${debugItem.zero_at}:${debugItem.zero_at + debugItem.depth}] `;
                    }
                }
                if (debugItem.lsb_at === 0) {
                    this.description += `[${debugItem.width}]`;
                } else {
                    this.description += `[${debugItem.lsb_at}:${debugItem.lsb_at + debugItem.width}]`;
                }
                break;
            }
        }
        if (debugItem.src.length > 0) {
            this.command = {
                title: "Reveal in Editor",
                command: 'vscode.open',
                arguments: this.openCommandArguments(debugItem.src[0])
            };
        }
    }

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
        // FIXME: this doesn't seem to navigate to `selection`
        return vscode.Uri.parse(`command:vscode.open?${encodeURIComponent(JSON.stringify(args))}`);
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
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('cxxrtlDebugger.rangeStyle')) {
                this._onDidChangeTreeData.fire(null);
            }
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

