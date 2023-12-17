import * as vscode from 'vscode';
import { CXXRTLDebugger } from './debugger';
import { CXXRTLDebugItem, CXXRTLDebugItemType, ICXXRTLSourceLocation } from './connection';

export class CXXRTLVariableTreeItem extends vscode.TreeItem {
    public override id: string;

    constructor(id: string, debugItem: CXXRTLDebugItem, value: bigint | undefined) {
        const label = id.substring(id.lastIndexOf(' ') + 1);
        super(label, vscode.TreeItemCollapsibleState.None);
        this.id = id;
        this.tooltip = new vscode.MarkdownString();
        this.tooltip.isTrusted = true;
        this.tooltip.appendMarkdown(`${id.split(' ').join('.')}\n\n`);
        for (const location of debugItem.sourceLocations) {
            const sourceRelativePath = vscode.workspace.asRelativePath(location.file);
            this.tooltip.appendMarkdown(`- [${sourceRelativePath}:${location.startLine}](${this.openCommandUri(location)})`);
        }
        switch (debugItem.type) {
            case 'node':
                this.iconPath = new vscode.ThemeIcon('symbol-variable');
                break;
            case 'memory':
                this.iconPath = new vscode.ThemeIcon('symbol-array');
                break;
        }
        this.description = '';
        const displayStyle = vscode.workspace.getConfiguration('cxxrtlDebugger').get('displayStyle');
        if (debugItem.width !== 1) {
            switch (displayStyle) {
                case 'Verilog':
                case 'VHDL':
                    this.description += `[${debugItem.lsbAt + debugItem.width - 1}:${debugItem.lsbAt}]`;
                    if (debugItem.type === CXXRTLDebugItemType.Memory) {
                        this.description += ` [${debugItem.zeroAt}:${debugItem.zeroAt! + debugItem.depth! - 1}]`;
                    }
                    break;

                case 'Python':
                    if (debugItem.type === CXXRTLDebugItemType.Memory) {
                        if (debugItem.zeroAt === 0) {
                            this.description += `[${debugItem.depth}] `;
                        } else {
                            this.description += `[${debugItem.zeroAt}:${debugItem.zeroAt! + debugItem.depth!}] `;
                        }
                    }
                    if (debugItem.lsbAt === 0) {
                        this.description += `[${debugItem.width}]`;
                    } else {
                        this.description += `[${debugItem.lsbAt}:${debugItem.lsbAt + debugItem.width}]`;
                    }
                    break;
                }
        }
        if (value !== undefined) {
            if (this.description !== '') {
                this.description += ' = ';
            } else {
                this.description += '= ';
            }
            if (debugItem.width === 1) {
                this.description += value.toString();
            } else {
                switch (displayStyle) {
                    case 'Verilog':
                        this.description += `16'${value.toString(16)}`;
                        break;

                    case 'VHDL':
                        this.description += `X"${value.toString(16)}"`;
                        break;

                    case 'Python':
                        this.description += `0x${value.toString(16)}`;
                        break;
                }
            }
        }
        if (debugItem.sourceLocations.length > 0) {
            this.command = {
                title: "Reveal in Editor",
                command: 'vscode.open',
                arguments: this.openCommandArguments(debugItem.sourceLocations[0])
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
        this.cxxrtlDebugger.onDidChangeSessionStatus((_state) => {
            this._onDidChangeTreeData.fire(null);
        });
        this.cxxrtlDebugger.onDidChangeCurrentTime((_time) => {
            this._onDidChangeTreeData.fire(null);
        });
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('cxxrtlDebugger.displayStyle')) {
                this._onDidChangeTreeData.fire(null);
            }
        });
    }

    public set scope(scope: string) {
        this._scope = scope;
        this._onDidChangeTreeData.fire(null);
    }

    public getTreeItem(element: CXXRTLVariableTreeItem): vscode.TreeItem {
        return element;
    }

    public async getChildren(element?: CXXRTLVariableTreeItem): Promise<CXXRTLVariableTreeItem[]> {
        if (element) {
            // TODO: expand signals and memories
            return [];
        }

        const variables = await this.cxxrtlDebugger.listVariables(this.scope);
        const values = await this.cxxrtlDebugger.getVariableValues(Array.from(variables.values()));
        let elements: CXXRTLVariableTreeItem[] = [];
        for (let [name, description] of variables) {
            elements.push(new CXXRTLVariableTreeItem(name, description, values.get(name)));
        }
        return elements;
    }
}

