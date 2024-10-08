import * as vscode from 'vscode';

export interface IWatchItem {
    id: string;
    row?: number;
    bit?: number;
}

export interface IWatchList {
    get(): IWatchItem[];
    set(items: IWatchItem[]): void;
    append(item: IWatchItem): void;
    remove(index: number): void;

    onDidChange(callback: (items: IWatchItem[]) => any): vscode.Disposable;
}

export const globalWatchList: IWatchList = {
    get(): IWatchItem[] {
        return vscode.workspace.getConfiguration('rtlDebugger').get('watchList') || [];
    },

    set(items: IWatchItem[]): void {
        vscode.workspace.getConfiguration('rtlDebugger').update('watchList', items);
    },

    append(item: IWatchItem): void {
        this.set(this.get().concat(item));
    },

    remove(index: number): void {
        const items = this.get();
        items.splice(index, 1);
        this.set(items);
    },

    onDidChange(callback: (items: IWatchItem[]) => any): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('rtlDebugger.watchList')) {
                callback(globalWatchList.get());
            }
        });
    },
};
