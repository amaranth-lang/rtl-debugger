import * as vscode from 'vscode';

import { MemoryVariable, ScalarVariable, Variable } from './variable';
import { globalVariableOptions } from '../debug/options';

export enum DisplayStyle {
    Python = 'Python',
    Verilog = 'Verilog',
    VHDL = 'VHDL',
}

export function variableDescription(style: DisplayStyle, variable: Variable, { scalar = false } = {}): string {
    let result = '';
    if (variable instanceof ScalarVariable && variable.lsbAt === 0 && variable.width === 1) {
        return result;
    }
    switch (style) {
        case DisplayStyle.Python: {
            if (variable instanceof MemoryVariable && !scalar) {
                if (variable.zeroAt === 0) {
                    result += `[${variable.depth}] `;
                } else {
                    result += `[${variable.zeroAt}:${variable.zeroAt + variable.depth}] `;
                }
            }
            if (variable.lsbAt === 0) {
                result += `[${variable.width}]`;
            } else {
                result += `[${variable.lsbAt}:${variable.lsbAt + variable.width}] `;
            }
            return result;
        }

        case DisplayStyle.Verilog:
        case DisplayStyle.VHDL: {
            result += `[${variable.lsbAt + variable.width - 1}:${variable.lsbAt}]`;
            if (variable instanceof MemoryVariable && !scalar) {
                result += ` [${variable.zeroAt}:${variable.zeroAt + variable.depth - 1}] `;
            }
            return result;
        }
    }
}

export function* variableBitIndices(style: DisplayStyle, variable: Variable): Generator<number> {
    switch (style) {
        case DisplayStyle.Python: {
            for (let index = 0; index < variable.width; index++) {
                yield variable.lsbAt + index;
            }
            return;
        }

        case DisplayStyle.Verilog:
        case DisplayStyle.VHDL: {
            for (let index = variable.width - 1; index >= 0; index--) {
                yield variable.lsbAt + index;
            }
        }
    }
}

export function* memoryRowIndices(variable: MemoryVariable): Generator<number> {
    for (let index = 0; index < variable.depth; index++) {
        yield variable.zeroAt + index;
    }
}

export function variableValue(style: DisplayStyle, variable: Variable, value: bigint | undefined, radix?: 2 | 8 | 10 | 16): string {
    if (value === undefined) {
        return '...';
    }

    // There is a bug in CXXRTL that occasionally causes out-of-bounds bits to be set.
    // Ideally it should be fixed there, but for now let's work around it here, for usability.
    value &= (1n << BigInt(variable.width)) - 1n;

    if (variable.width === 1) {
        return value.toString();
    } else {
        if (radix === undefined) {
            radix = globalVariableOptions.get(variable.cxxrtlIdentifier).radix ?? 10;
        }
        switch (style) {
            case DisplayStyle.Python:
                switch (radix) {
                    case 2:  return `0b${value.toString(2)}`;
                    case 8:  return `0o${value.toString(8)}`;
                    case 10: return      value.toString(10);
                    case 16: return `0x${value.toString(16)}`;
                }

            case DisplayStyle.Verilog:
                return `${radix}'${value.toString(radix)}`;

            case DisplayStyle.VHDL:
                switch (radix) {
                    case 2:  return `B"${value.toString(2)}"`;
                    case 8:  return `O"${value.toString(8)}"`;
                    case 10: return      value.toString(10);
                    case 16: return `X"${value.toString(16)}"`;
                }
        }
    }
}

export function variableTooltip(variable: Variable): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString(variable.fullName.join('.'));
    tooltip.isTrusted = true;
    if (variable.location) {
        tooltip.appendMarkdown(`\n\n- ${variable.location.asMarkdownLink()}`);
    }
    return tooltip;
}
