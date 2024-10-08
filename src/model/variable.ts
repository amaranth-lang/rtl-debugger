import * as proto from '../cxxrtl/proto';
import { MemoryRangeDesignation, MemoryRowDesignation, ScalarDesignation } from './sample';
import { Location } from './source';

export abstract class Variable {
    constructor(
        readonly fullName: string[],
        readonly location: Location | null,
        readonly lsbAt: number,
        readonly width: number,
    ) {}

    static fromCXXRTL(cxxrtlName: string, cxxrtlDesc: proto.ItemDescription): Variable {
        const fullName = cxxrtlName.split(' ');
        if (cxxrtlDesc.type === 'node') {
            return new ScalarVariable(
                fullName,
                Location.fromCXXRTL(cxxrtlDesc.src),
                cxxrtlDesc.lsb_at,
                cxxrtlDesc.width,
            );
        } else if (cxxrtlDesc.type === 'memory') {
            return new MemoryVariable(
                fullName,
                Location.fromCXXRTL(cxxrtlDesc.src),
                cxxrtlDesc.lsb_at,
                cxxrtlDesc.width,
                cxxrtlDesc.zero_at,
                cxxrtlDesc.depth,
            );
        } else {
            throw new Error(`Unknown item type in ${cxxrtlDesc}`);
        }
    }

    get name(): string {
        return this.fullName.at(-1)!;
    }

    get scopeFullName(): string[] {
        return this.fullName.slice(0, -1);
    }

    get cxxrtlIdentifier(): string {
        return this.fullName.join(' ');
    }
}

export class ScalarVariable extends Variable {
    designation(): ScalarDesignation {
        return new ScalarDesignation(this);
    }
}

export class MemoryVariable extends Variable {
    constructor(
        fullName: string[],
        location: Location | null,
        lsbAt: number,
        width: number,
        readonly zeroAt: number,
        readonly depth: number,
    ) {
        super(fullName, location, lsbAt, width);
    }

    designation(index: number): MemoryRowDesignation;
    designation(first: number, last: number): MemoryRangeDesignation;
    designation(): MemoryRangeDesignation;

    designation(firstOrIndex?: number, last?: number): MemoryRowDesignation | MemoryRangeDesignation {
        if (firstOrIndex !== undefined && last === undefined) {
            return new MemoryRowDesignation(this, firstOrIndex);
        } else if (firstOrIndex !== undefined && last !== undefined) {
            return new MemoryRangeDesignation(this, firstOrIndex, last);
        } else {
            return new MemoryRangeDesignation(this, 0, this.depth - 1);
        }
    }
}
