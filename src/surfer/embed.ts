import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../ui/waveform';

document.addEventListener('DOMContentLoaded', () => {
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
        if (message.type === 'drawRect') {
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = 'red';
            ctx.fillRect(...message.bounds);
        } else {
            console.error('[RTL Debugger] [surferEmbed] Unhandled extension to webview message', message);
        }
    });

    overlay.style.display = 'none';
    postMessage({ type: 'ready' });
});
