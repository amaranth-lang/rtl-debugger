import libsurferInit, * as libsurfer from 'libsurfer';

import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../ui/waveform';

function libsurferInjectMessage(message: any) {
    libsurfer.inject_message(JSON.stringify(message));
}

document.addEventListener('DOMContentLoaded', async () => {
    const vscode = acquireVsCodeApi();
    const canvas = <HTMLCanvasElement>document.getElementById('canvas');
    const overlay = <HTMLDivElement>document.getElementById('overlay');

    canvas.height = canvas.clientHeight;
    canvas.width = canvas.clientWidth;
    canvas.addEventListener('resize', () => {
        canvas.height = canvas.clientHeight;
        canvas.width = canvas.clientWidth;
    });

    const postMessage = <(message: WebviewToExtensionMessage) => void>vscode.postMessage;
    window.addEventListener('message', (event: MessageEvent<ExtensionToWebviewMessage>) => {
        const message = event.data;
        console.error('[RTL Debugger] [surferEmbed] Unhandled extension to webview message', message);
    });

    try {
        await libsurferInit();
        await new libsurfer.WebHandle().start(canvas);

        libsurferInjectMessage('ToggleMenu'); // turn off menu
        libsurferInjectMessage('ToggleStatusBar'); // turn off status bar
        libsurferInjectMessage('ToggleSidePanel');
        libsurferInjectMessage({ SelectTheme: 'dark+' }); // pick VS Code like theme

        overlay.style.display = 'none';
        postMessage({ type: 'ready' });
    } catch (error) {
        overlay.innerHTML = `Could not start Surfer waveform viewer.<br><br>Cause: ${error}`;
        postMessage({ type: 'crash', error });
    }
});
