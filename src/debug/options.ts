import * as vscode from 'vscode';

export interface IVariableOptions {
    radix?: 2 | 8 | 10 | 16
}

export interface IVariableOptionStore {
    get(id: string): IVariableOptions;
    set(id: string, options: IVariableOptions): void;
    update(id: string, options: IVariableOptions): void;
}

export const globalVariableOptions: IVariableOptionStore = {
    get(id: string): IVariableOptions {
        const optionStore: {[id: string]: IVariableOptions} =
            vscode.workspace.getConfiguration('rtlDebugger').get('variableOptions') || {};
        return optionStore[id] || {};
    },

    set(id: string, options: IVariableOptions): void {
        const optionStore: {[id: string]: IVariableOptions} =
            vscode.workspace.getConfiguration('rtlDebugger').get('variableOptions') || {};
        optionStore[id] = options;
        vscode.workspace.getConfiguration('rtlDebugger').update('variableOptions', optionStore);
    },

    update(id: string, addedOptions: IVariableOptions): void {
        const options = Object.fromEntries(Object.entries(this.get(id)));
        Object.assign(options, addedOptions);
        this.set(id, options);
    }
};
