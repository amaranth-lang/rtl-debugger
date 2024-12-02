import * as vscode from 'vscode';

import { CXXRTLDebugger } from '../debugger';
// @ts-ignore
import embedHtml from '../surfer/embed.html';

export type ExtensionToWebviewMessage =
| { type: 'restore', state: any }
| { type: 'drawRect', bounds: [number, number, number, number] }
;

export type WebviewToExtensionMessage =
| { type: 'ready' }
| { type: 'crash', error: any }
;

export class WaveformProvider {
    constructor(
        private rtlDebugger: CXXRTLDebugger,
        private webviewPanel: vscode.WebviewPanel,
        bundleRoot: vscode.Uri,
    ) {
        const webviewHtml = embedHtml.replace(/__base_href__/,
            this.webview.asWebviewUri(bundleRoot).toString());
        this.webview.onDidReceiveMessage(this.processMessage.bind(this));
        this.webview.html = webviewHtml;
    }

    dispose() {
        this.webviewPanel.dispose();
    }

    get webview() {
        return this.webviewPanel.webview;
    }

    private async sendMessage(message: ExtensionToWebviewMessage) {
        const messagePosted = await this.webview.postMessage(message);
        if (!messagePosted) {
            console.warn('[RTL Debugger] [WaveformProvider] Dropping extension to webview message:', message);
        }
    }

    private async processMessage(message: WebviewToExtensionMessage) {
        if (message.type === 'ready') {
            console.log('[RTL Debugger] [WaveformProvider] Ready');
            this.sendMessage({ type: 'drawRect', bounds: [0, 0, 100, 100]});
        } else if (message.type === 'crash') {
            console.log('[RTL Debugger] [WaveformProvider] Crash:', message.error);
        } else {
            console.error('[RTL Debugger] [WaveformProvider] Unhandled webview to extension message:', message);
        }
    }
}
