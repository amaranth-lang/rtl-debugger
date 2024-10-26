import * as vscode from 'vscode';

import { CXXRTLDebugger } from '../debugger';
import { UnboundReference } from '../model/sample';
import { ScalarVariable, Variable } from '../model/variable';
import { DisplayStyle, languageForDisplayStyle, variableDescription, variableValue } from '../model/styling';
import { Session } from '../debug/session';

export class HoverProvider implements vscode.HoverProvider {
    static readonly SUPPORTED_LANGUAGES: string[] = ['verilog', 'systemverilog'];

    constructor(
        private rtlDebugger: CXXRTLDebugger
    ) {}

    private async hoverForVariables(session: Session, variables: Variable[]): Promise<vscode.Hover | null> {
        if (variables.length === 0) {
            return null;
        }
        const displayStyle = vscode.workspace.getConfiguration('rtlDebugger').get('displayStyle') as DisplayStyle;
        const hoverText = new vscode.MarkdownString();
        const unboundReference = new UnboundReference();
        for (const variable of variables) {
            if (variable instanceof ScalarVariable) {
                unboundReference.add(variable.designation());
            }
        }
        const reference = session.bindReference('hover', unboundReference);
        const sample = await session.queryAtCursor(reference);
        for (const [designation, handle] of reference.allHandles()) {
            const variable = designation.variable;
            const descriptionText = variableDescription(displayStyle, variable);
            const valueText = variableValue(displayStyle, variable, sample.extract(handle));
            hoverText.appendCodeblock(
                `${variable.fullName.join('.')}${descriptionText} = ${valueText}`,
                languageForDisplayStyle(displayStyle)
            );
        }
        return new vscode.Hover(hoverText);
    }

    async provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover | null> {
        const session = this.rtlDebugger.session;
        if (session !== null) {
            const definitions = await (
                vscode.commands.executeCommand('vscode.executeDefinitionProvider', document.uri, position) as
                vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]>
            );
            let definition: vscode.Location | undefined;
            if (definitions instanceof vscode.Location) {
                definition = definitions;
            } else if (definitions instanceof Array && definitions.length === 1 && definitions[0] instanceof vscode.Location) {
                definition = definitions[0];
            } else {
                console.warn('vscode.executeDefinitionProvider did not return a single Location: ', definition);
                return null;
            }
            const variables = await session.getVariablesForLocation(definition.uri.fsPath, definition.range.start);
            return await this.hoverForVariables(session, variables);
        }
        return null;
    }
}
