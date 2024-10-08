import * as vscode from 'vscode';
import { TimePoint } from '../model/time';

export async function inputTime(options: { prompt?: string } = {}): Promise<TimePoint | undefined> {
    const inputValue = await vscode.window.showInputBox({
        placeHolder: '10 ms',
        prompt: options.prompt,
        validateInput(value) {
            try {
                TimePoint.fromString(value);
                return null;
            } catch (e) {
                if (e instanceof SyntaxError) {
                    return e.message;
                } else {
                    throw e;
                }
            }
        },
    });

    if (inputValue !== undefined) {
        return TimePoint.fromString(inputValue);
    } else {
        return undefined;
    }
}
