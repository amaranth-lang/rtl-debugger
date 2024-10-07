import { MemoryVariable, ScalarVariable, Variable } from './variable';

export enum DisplayStyle {
    Python = 'Python',
    Verilog = 'Verilog',
    VHDL = 'VHDL',
}

export function variableDescription(style: DisplayStyle, variable: Variable): string {
    let result = '';
    if (variable instanceof ScalarVariable && variable.lsbAt === 0 && variable.width === 1) {
        return result;
    }
    switch (style) {
        case DisplayStyle.Python: {
            if (variable instanceof MemoryVariable) {
                if (variable.zeroAt === 0) {
                    result += `[${variable.depth}] `;
                } else {
                    result += `[${variable.zeroAt}:${variable.zeroAt + variable.depth}] `;
                }
            }
            if (variable.lsbAt === 0) {
                result += `[${variable.width}]`;
            } else {
                result += `[${variable.lsbAt}:${variable.lsbAt + variable.width}]`;
            }
            return result;
        }

        case DisplayStyle.Verilog:
        case DisplayStyle.VHDL: {
            result += `[${variable.lsbAt + variable.width - 1}:${variable.lsbAt}]`;
            if (variable instanceof MemoryVariable) {
                result += ` [${variable.zeroAt}:${variable.zeroAt + variable.depth - 1}]`;
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

export function variableValue(style: DisplayStyle, base: 2 | 8 | 10 | 16, variable: Variable, value: bigint): string {
    if (variable.width === 1) {
        return value.toString();
    } else {
        switch (style) {
            case DisplayStyle.Python:
                switch (base) {
                    case 2:  return `0b${value.toString(2)}`;
                    case 8:  return `0o${value.toString(8)}`;
                    case 10: return `0d${value.toString(10)}`;
                    case 16: return `0x${value.toString(16)}`;
                }

            case DisplayStyle.Verilog:
                return `${base}'${value.toString(base)}`;

            case DisplayStyle.VHDL:
                switch (base) {
                    case 2:  return `B"${value.toString(2)}"`;
                    case 8:  return `O"${value.toString(8)}"`;
                    case 10: return      value.toString(10);
                    case 16: return `X"${value.toString(16)}"`;
                }
        }
    }
}
