import * as proto from '../cxxrtl/proto';
import { TimePoint } from './time';
import { MemoryVariable, ScalarVariable, Variable } from './variable';

function chunksForBits(width: number): number {
    return 0 | ((width + 31) / 32);
}

function getChunksAt(array: Uint32Array, offset: number, count: number) {
    let value = 0n;
    for (let index = offset; index < offset + count; index++) {
        value = (value << 32n) + BigInt(array[offset]);
    }
    return value;
}

// This class is a bit weird because the CXXRTL range designator is inclusive and has configurable
// direction. I.e. `[0, 1]` and `[1, 0]` both designate two rows, in opposite order.
class ReferenceSlice {
    constructor(
        readonly offset: number, // in chunks
        readonly variable: Variable,
        readonly range?: [number, number],
    ) {}

    get size(): number {
        return this.count * this.stride;
    }

    get count(): number {
        if (this.range === undefined) {
            return 1; // scalar
        } else {
            const [first, last] = this.range;
            return (last >= first) ? (last - first + 1) : (first - last + 1);
        }
    }

    get stride(): number {
        return chunksForBits(this.variable.width);
    }

    hasIndex(index: number): boolean {
        let begin, end;
        if (this.range === undefined) {
            begin = 0;
            end = 1;
        } else {
            const [first, last] = this.range;
            if (last >= first) {
                begin = first;
                end = last + 1;
            } else {
                begin = last;
                end = first + 1;
            }
        }
        return (index >= begin && index < end);
    }

    offsetForIndex(index: number): number {
        if (this.range === undefined) {
            return this.offset;
        }
        const [first, last] = this.range;
        if (last >= first) {
            return this.offset + this.stride * (index - first);
        } else {
            return this.offset + this.stride * (index - last);
        }
    }
}

export class Reference {
    private frozen: boolean = false;
    private totalSize: number = 0; // in chunks
    private slices: ReferenceSlice[] = [];
    private variables: Map<Variable, ReferenceSlice> = new Map();

    constructor(variables: Variable[] = []) {
        for (const variable of variables) {
            this.add(variable);
        }
    }

    freeze() {
        this.frozen = true;
    }

    copy(): Reference {
        const newInstance = new Reference();
        newInstance.totalSize = this.totalSize;
        newInstance.slices = this.slices.slice();
        newInstance.variables = new Map(this.variables.entries());
        return newInstance;
    }

    add(variable: Variable): void;
    add(memory: MemoryVariable, first: number, last: number): void;

    add(variable: Variable, first?: number, last?: number) {
        if (this.frozen) {
            throw new Error(`Cannot add variables to a reference that has been bound to a name`);
        }
        if (this.variables.has(variable)) {
            // This is not a CXXRTL limitation, but a consequence of the use of `Map` for fast
            // lookup of sample data during extraction.
            throw new Error(`Unable to reference variable ${variable.fullName} twice`);
        }
        let range: [number, number] | undefined;
        if (variable instanceof MemoryVariable) {
            if (first === undefined || last === undefined) {
                range = [0, variable.depth - 1];
            } else {
                range = [first, last];
            }
        }
        const slice = new ReferenceSlice(this.totalSize, variable, range);
        this.totalSize += slice.size;
        this.slices.push(slice);
        this.variables.set(variable, slice);
    }

    extract(variableData: Uint32Array, variable: Variable, index: number = 0): bigint {
        const slice = this.variables.get(variable);
        if (slice === undefined) {
            throw RangeError(`Variable ${variable.fullName} is not referenced`);
        }
        if (!slice.hasIndex(index)) {
            throw RangeError(`Variable ${variable.fullName} is referenced but index ${index} is out of bounds`);
        }
        return getChunksAt(variableData, slice.offsetForIndex(index), slice.stride);
    }

    cxxrtlItemDesignations(): proto.ItemDesignation[] {
        return this.slices.map((slice) => {
            if (slice.variable instanceof ScalarVariable) {
                return slice.variable.cxxrtlItemDesignation();
            } else if (slice.variable instanceof MemoryVariable) {
                if (slice.range === undefined) {
                    return slice.variable.cxxrtlItemDesignation();
                } else {
                    const [first, last] = slice.range;
                    return slice.variable.cxxrtlItemDesignation(first, last);
                }
            } else {
                throw new Error(`Unknown variable type in ${slice.variable}`);
            }
        });
    }
}

export class BoundReference {
    constructor(
        readonly name: string,
        readonly epoch: number,
        readonly unbound: Reference,
    ) {
        this.unbound.freeze();
    }
}

export class Sample {
    constructor(
        readonly time: TimePoint,
        readonly reference: Reference,
        readonly variableData: Uint32Array,
    ) {}

    extract(scalar: ScalarVariable): bigint;
    extract(memory: MemoryVariable, row: number): bigint;

    extract(variable: Variable, offset: number = 0): bigint {
        return this.reference.extract(this.variableData, variable, offset);
    }
}
