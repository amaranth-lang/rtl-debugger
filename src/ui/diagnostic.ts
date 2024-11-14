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
            this.update(session);
            if (session !== null) {
                session.onDidChangeSimulationStatus((_simulationStatus) => this.update(session));
                session.onDidChangeTimeCursor((_timeCursor) => this.update(session));
            }
        });
    }

    dispose() {
        this.diagnosticCollection.dispose();
    }

    private async update(session: Session | null) {
        if (session === null || session?.simulationStatus.status === 'running') {
            this.apply([]);
        } else {
            const sample = await session.queryAtCursor({ diagnostics: true });
            this.apply(sample.diagnostics!);
        }
    }

    private apply(diagnostics: Diagnostic[]) {
        const diagnosticMap = new Map();
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
            if (message !== '') {
                const mappedDiagnostic = new vscode.Diagnostic(range, message, severity);
                mappedDiagnostic.code = <string>diagnostic.type;
                mappedDiagnostic.source = 'RTL Debug';
                diagnosticMap.get(uri).push(mappedDiagnostic);
            }
        }

        this.diagnosticCollection.clear();
        this.diagnosticCollection.set(Array.from(diagnosticMap.entries()));
    }
}
