import * as vscode from 'vscode';

import { CXXRTLDebugger } from '../debugger';
import { Diagnostic, DiagnosticType } from '../model/sample';
import { Session } from '../debug/session';

export class DiagnosticProvider {
    constructor(
        private rtlDebugger: CXXRTLDebugger,
        private diagnosticCollection: vscode.DiagnosticCollection,
    ) {
        rtlDebugger.onDidChangeSession((session) => {
            if (session === null) {
                this.clear();
            } else {
                session.onDidChangeSimulationStatus((simulationStatus) => {
                    if (simulationStatus.status === 'running') {
                        this.clear();
                    }
                });
                session.onDidChangeTimeCursor((_timeCursor) => {
                    this.request(session);
                });
                this.request(session);
            }
        });
    }

    dispose() {
        this.diagnosticCollection.dispose();
    }

    private async clear() {
        this.apply([]);
    }

    private async request(session: Session) {
        const sample = await session.queryAtCursor({ diagnostics: true });
        this.apply(sample.diagnostics!);
    }

    private apply(diagnostics: Diagnostic[]) {
        const diagnosticMap = new Map();
        let mostImportantDiagnostic = null;
        let mostImportantDiagnosticSeverity = vscode.DiagnosticSeverity.Hint;
        let multipleImportantDiagnostics = false;
        for (const diagnostic of diagnostics) {
            if (diagnostic.location === null) {
                continue;
            }
            const uri = diagnostic.location.fileUri;
            const range = diagnostic.location.range;
            if (!diagnosticMap.has(uri)) {
                diagnosticMap.set(uri, []);
            }

            console.warn('[RTL Debugger]', diagnostic);

            let message;
            let severity;
            switch (diagnostic.type) {
                case DiagnosticType.Break:
                    if (diagnostic.text !== '') {
                        message = `breakpoint: ${diagnostic.text}`;
                    } else {
                        message = 'breakpoint';
                    }
                    severity = vscode.DiagnosticSeverity.Warning;
                    break;

                case DiagnosticType.Print:
                    message = diagnostic.text;
                    severity = vscode.DiagnosticSeverity.Information;
                    break;

                case DiagnosticType.Assert:
                    if (diagnostic.text !== '') {
                        message = `assertion violated: ${diagnostic.text}`;
                    } else {
                        message = 'assertion violated';
                    }
                    severity = vscode.DiagnosticSeverity.Error;
                    break;

                case DiagnosticType.Assume:
                    if (diagnostic.text !== '') {
                        message = `assumption violated: ${diagnostic.text}`;
                    } else {
                        message = 'assumption violated';
                    }
                    severity = vscode.DiagnosticSeverity.Error;
                    break;

                default:
                    message = `(unknown diagnostic type ${diagnostic.type}): ${diagnostic.text}`;
                    severity = vscode.DiagnosticSeverity.Error;
                    break;
            }
            if (severity !== vscode.DiagnosticSeverity.Information && diagnostic.location !== null) {
                // Prioritize assertions/assumptions over breakpoints. (It's unclear whether this
                // specific prioritization is the best one, but one of them should probably take
                // priority over the other.)
                multipleImportantDiagnostics = (mostImportantDiagnostic !== null);
                if (severity < mostImportantDiagnosticSeverity) {
                    mostImportantDiagnostic = diagnostic;
                    mostImportantDiagnosticSeverity = severity;
                }
            }

            if (message !== '') {
                const mappedDiagnostic = new vscode.Diagnostic(range, message, severity);
                mappedDiagnostic.code = <string>diagnostic.type;
                mappedDiagnostic.source = 'RTL Debug';
                diagnosticMap.get(uri).push(mappedDiagnostic);
            }
        }

        this.diagnosticCollection.clear();
        this.diagnosticCollection.set(Array.from(diagnosticMap.entries()));

        if (mostImportantDiagnostic !== null) {
            this.focus(mostImportantDiagnostic, multipleImportantDiagnostics);
        }
    }

    private async focus(diagnostic: Diagnostic, showDiagnosticsPane: boolean = false) {
        if (showDiagnosticsPane) {
            await vscode.commands.executeCommand('workbench.actions.view.problems');
        }
        // 2024-11-14: Upsettingly, this is the best (and, more or less, only) way to expand a diagnostic.
        await vscode.window.showTextDocument(...diagnostic.location!.openCommandArguments());
        await vscode.commands.executeCommand('editor.action.marker.next');
    }
}
