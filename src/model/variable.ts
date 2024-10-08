import * as proto from '../cxxrtl/proto';
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

    cxxrtlItemDesignation(): proto.ItemDesignation {
        return [this.cxxrtlIdentifier];
    }
}

export class ScalarVariable extends Variable {
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

    override cxxrtlItemDesignation(): proto.ItemDesignation;
    override cxxrtlItemDesignation(first: number, last: number): proto.ItemDesignation; // inclusive!
    override cxxrtlItemDesignation(first: number = 0, last: number = this.depth - 1): proto.ItemDesignation {
        if (first < 0 || first > this.depth) {
            throw new RangeError(`Start index ${first} out of range`);
        }
        if (last < 0 || last > this.depth) {
            throw new RangeError(`End index ${last} out of range`);
        }
        return [this.cxxrtlIdentifier, first, last];
    }
}
