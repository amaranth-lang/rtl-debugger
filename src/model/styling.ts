import * as vscode from 'vscode';

import { MemoryVariable, ScalarVariable, Variable } from './variable';
import { globalVariableOptions } from '../debug/options';

export enum DisplayStyle {
    Python = 'Python',
    Verilog = 'Verilog',
    VHDL = 'VHDL',
}

export function languageForDisplayStyle(style: DisplayStyle): string {
    return style as string;
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
        let stringValue;
        switch (radix) {
            case 2:  stringValue = value.toString(2) .padStart(variable.width / 1, '0'); break;
            case 8:  stringValue = value.toString(8) .padStart(variable.width / 3, '0'); break;
            case 10: stringValue = value.toString(10); break;
            case 16: stringValue = value.toString(16).padStart(variable.width / 4, '0'); break;
        }
        switch (style) {
            case DisplayStyle.Python:
                switch (radix) {
                    case 2:  return `0b${stringValue}`;
                    case 8:  return `0o${stringValue}`;
                    case 10: return      stringValue;
                    case 16: return `0x${stringValue}`;
                }

            case DisplayStyle.Verilog:
                switch (radix) {
                    case 2:  return `${variable.width}'b${stringValue}`;
                    case 8:  return `${variable.width}'o${stringValue}`;
                    case 10: return `${variable.width}'d${stringValue}`;
                    case 16: return `${variable.width}'h${stringValue}`;
                }

            case DisplayStyle.VHDL:
                switch (radix) {
                    case 2:  return `B"${stringValue}"`;
                    case 8:  return `O"${stringValue}"`;
                    case 10: return      stringValue;
                    case 16: return `X"${stringValue}"`;
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
