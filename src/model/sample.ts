import * as proto from '../cxxrtl/proto';
import { Location } from './source';
import { TimePoint } from './time';
import { MemoryVariable, ScalarVariable, Variable } from './variable';

class DataRange {
    readonly stride: number;
    readonly count: number;

    constructor(variable: Variable, count: number = 1) {
        this.stride = 0 | ((variable.width + 31) / 32);
        this.count = count;
    }

    get size() {
        return this.stride * this.count;
    }

    bigintFromRaw(data: Uint32Array, offset: number = 0) {
        if (!(offset <= this.count)) {
            throw RangeError(`Offset ${offset} out of bounds for data range with ${this.count} elements`);
        }
        let value = 0n;
        for (let index = 0; index < this.stride; index++) {
            value = (value << 32n) + BigInt(data[this.stride * offset + index]);
        }
        return value;
    }
}

export abstract class Designation<T> {
    abstract variable: Variable;

    abstract get canonicalKey(): string;

    abstract get cxxrtlItemDesignation(): proto.ItemDesignation;

    abstract dataRange(): DataRange;

    abstract extractFromRaw(data: Uint32Array): T;
}

export class ScalarDesignation extends Designation<bigint> {
    constructor(
        readonly variable: ScalarVariable,
    ) {
        super();
    }

    get canonicalKey(): string {
        return this.variable.fullName.join(' ');
    }

    get cxxrtlItemDesignation(): proto.ItemDesignation {
        return [this.variable.cxxrtlIdentifier];
    }

    override dataRange(): DataRange {
        return new DataRange(this.variable);
    }

    override extractFromRaw(data: Uint32Array): bigint {
        return this.dataRange().bigintFromRaw(data);
    }
}

export class MemoryRowDesignation extends Designation<bigint> {
    constructor(
        readonly variable: MemoryVariable,
        readonly index: number,
    ) {
        super();
    }

    get canonicalKey(): string {
        return `${this.variable.fullName.join(' ')}\u0000${this.index}`;
    }

    get cxxrtlItemDesignation(): proto.ItemDesignation {
        return [this.variable.cxxrtlIdentifier, this.index, this.index];
    }

    override dataRange(): DataRange {
        return new DataRange(this.variable);
    }

    override extractFromRaw(data: Uint32Array): bigint {
        return this.dataRange().bigintFromRaw(data);
    }
}

export class MemoryRangeDesignation extends Designation<Iterable<bigint>> {
    constructor(
        readonly variable: MemoryVariable,
        readonly first: number,
        readonly last: number,
    ) {
        super();
    }

    get canonicalKey(): string {
        return `${this.variable.fullName.join(' ')}\u0000${this.first}\u0000${this.last}`;
    }

    get cxxrtlItemDesignation(): proto.ItemDesignation {
        return [this.variable.cxxrtlIdentifier, this.first, this.last];
    }

    get count(): number {
        return (this.last >= this.first) ? (this.last - this.first + 1) : (this.first - this.last + 1);
    }

    override dataRange(): DataRange {
        return new DataRange(this.variable, this.count);
    }

    *extractFromRaw(data: Uint32Array): Iterable<bigint> {
        for (let offset = 0; offset < this.count; offset++) {
            yield this.dataRange().bigintFromRaw(data, offset);
        }
    }
}

export class Handle<T> {
    constructor(
        readonly designation: Designation<T>,
        readonly reference: UnboundReference,
        readonly offset: number,
    ) {}

    extractFromRaw(data: Uint32Array): T {
        return this.designation.extractFromRaw(data.subarray(this.offset));
    }
}

export class UnboundReference {
    private frozen: boolean = false;
    private offset: number = 0; // in chunks
    private handles: Handle<any>[] = [];

    add<T>(designation: Designation<T>): Handle<T> {
        if (this.frozen) {
            throw new Error('Cannot add variables to a reference that has been bound to a name');
        }
        const handle = new Handle(designation, this, this.offset);
        this.handles.push(handle);
        this.offset += designation.dataRange().size;
        return handle;
    }

    freeze() {
        this.frozen = true;
    }

    *allHandles(): Iterable<[Designation<any>, Handle<any>]> {
        for (const handle of this.handles) {
            yield [handle.designation, handle];
        }
    }

    cxxrtlItemDesignations(): proto.ItemDesignation[] {
        return this.handles.map((slice) => slice.designation.cxxrtlItemDesignation);
    }
}

export class Reference {
    constructor(
        readonly name: string,
        readonly epoch: number,
        readonly unbound: UnboundReference,
    ) {
        this.unbound.freeze();
    }

    allHandles(): Iterable<[Designation<any>, Handle<any>]> {
        return this.unbound.allHandles();
    }
}

export enum DiagnosticType {
    Break = 'break',
    Print = 'print',
    Assert = 'assert',
    Assume = 'assume',
}

export class Diagnostic {
    constructor(
        readonly type: DiagnosticType,
        readonly text: string,
        readonly location: Location | null,
    ) {}

    static fromCXXRTL(cxxrtlDiagnostic: proto.Diagnostic): Diagnostic {
        return new Diagnostic(
            <DiagnosticType>cxxrtlDiagnostic.type,
            cxxrtlDiagnostic.text,
            Location.fromCXXRTL(cxxrtlDiagnostic.src)
        );
    }
}

export class Sample {
    constructor(
        readonly time: TimePoint,
        readonly reference: UnboundReference | null,
        readonly variableData: Uint32Array | null,
        readonly diagnostics: Diagnostic[] | null,
    ) {
        if ((this.reference === null) !== (this.variableData === null)) {
            throw new Error('A sample must include both a reference and variable data, or neither');
        }
    }

    extract<T>(handle: Handle<T>): T {
        if (handle.reference !== this.reference) {
            throw new Error('Handle is not bound to the same reference as the sample');
        }
        if (this.variableData === null) {
            throw new Error('Sample does not include item values');
        }
        return handle.extractFromRaw(this.variableData);
    }
}
