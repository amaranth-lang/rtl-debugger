import * as vscode from 'vscode';

export class Location {
    constructor(
        readonly file: string,
        // All zero-based, like VS Code itself.
        readonly startLine: number,
        readonly startColumn?: number,
        readonly endLine?: number,
        readonly endColumn?: number,
    ) {}

    static fromCXXRTL(locationString: string | null): Location | null {
        if (locationString === null) {
            return null;
        }
        const matches = locationString.match(/^(.+?):(\d+)(?:\.(\d+)(?:-(\d+)\.(\d+)))?$/);
        if (!matches) {
            return null;
        }
        return new Location(
            matches[1],
            parseInt(matches[2]) - 1,
            matches.length >= 4 ? parseInt(matches[3]) - 1 : undefined,
            matches.length >= 4 ? parseInt(matches[4]) - 1 : undefined,
            matches.length >= 6 ? parseInt(matches[5]) - 1 : undefined,
        );
    }

    get fileUri(): vscode.Uri {
        return vscode.Uri.file(this.file);
    }

    get range(): vscode.Range {
        return new vscode.Range(
            this.startLine,
            this.startColumn ?? 0,
            this.endLine ?? this.startLine,
            this.endColumn ?? this.startColumn ?? 0
        );
    }

    private openCommandArguments(): [vscode.Uri, vscode.TextDocumentShowOptions] {
        const position = new vscode.Position(this.startLine, this.startColumn ?? 0);
        return [
            this.fileUri,
            {
                selection: new vscode.Selection(position, position),
                preview: true,
                preserveFocus: false
            }
        ];
    }

    asOpenCommand(): vscode.Command {
        return {
            title: 'Reveal in Editor',
            command: 'rtlDebugger.openDocument',
            arguments: this.openCommandArguments(),
        };
    }

    asOpenCommandUri(): vscode.Uri {
        const args = this.openCommandArguments();
        return vscode.Uri.parse(`command:rtlDebugger.openDocument?${encodeURIComponent(JSON.stringify(args))}`);
    }

    asMarkdownLink(): string {
        const sourceRelativePath = vscode.workspace.asRelativePath(this.file);
        return `[${sourceRelativePath}:${this.startLine + 1}](${this.asOpenCommandUri()})`;
    }
}
