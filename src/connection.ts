import * as cxxrtlLink from './cxxrtl/link';
import * as cxxrtlServer from './cxxrtl/server';
import { TimeInterval, TimePoint } from './time';

export interface ICXXRTLAgentError {
    name: string;
    message: string;
}

export interface ICXXRTLSourceLocation {
    file: string;
    startLine: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
}

class YosysSourceLocation implements ICXXRTLSourceLocation {
    constructor(
        public file: string,
        public startLine: number,
        public startColumn?: number,
        public endLine?: number,
        public endColumn?: number,
    ) {}

    public static parse(src: string): YosysSourceLocation | null {
        const matches = src.match(/^(.+?):(\d+)(?:\.(\d+)(?:-(\d+)\.(\d+)))?$/);
        if (!matches) {
            return null;
        }
        return new YosysSourceLocation(
            matches[1],
            parseInt(matches[2]),
            matches.length >= 4 ? parseInt(matches[3]) : undefined,
            matches.length >= 4 ? parseInt(matches[4]) : undefined,
            matches.length >= 6 ? parseInt(matches[5]) : undefined,
        );
    }
}

export enum CXXRTLDebugItemType {
    Node = "node",
    Memory = "memory"
}

export class CXXRTLDebugItem {
    sourceLocations: ICXXRTLSourceLocation[] = [];

    constructor(
        public readonly name: string,
        public readonly type: CXXRTLDebugItemType,
        public readonly width: number,
        public readonly lsbAt: number,
        public readonly depth?: number,
        public readonly zeroAt?: number
    ) {}
}

export interface ICXXRTLDesignation {
    readonly item: CXXRTLDebugItem;
    readonly name: string;

    toJSON(): any;
}

export class CXXRTLNodeDesignation implements ICXXRTLDesignation {
    constructor(
        public readonly item: CXXRTLDebugItem
    ) {}

    public get name(): string {
        return this.item.name;
    }

    public toJSON(): [string] {
        return [this.item.name];
    }
}

export class CXXRTLMemoryDesignation implements ICXXRTLDesignation {
    constructor(
        public readonly item: CXXRTLDebugItem,
        public readonly startIndex: number,
        public readonly endIndex: number
    ) {
        if (item.depth !== undefined) {
            if (startIndex < 0 || startIndex > item.depth) {
                throw new RangeError(`Start index ${startIndex} out of range`);
            }
            if (endIndex < 0 || endIndex > item.depth) {
                throw new RangeError(`End index ${startIndex} out of range`);
            }
        }
    }

    public get name(): string {
        return this.item.name;
    }

    public toJSON(): [string, number, number] {
        return [this.item.name, this.startIndex, this.endIndex];
    }
}

export interface ICXXRTLReference {
    name: string;
}

export class CXXRTLReference implements ICXXRTLReference {
    constructor(
        public readonly name: string,
        public readonly designations: ICXXRTLDesignation[]
    ) {}
}

export enum CXXRTLSimulationStatus {
    Paused = "paused",
    Running = "running",
    Finished = "finished",
}

function chunksFor(width: number): number {
    return 0 | ((width + 31) / 32);
}

function getChunksAt(array: Uint32Array, offset: number, count: number) {
    let value = 0n;
    for (let index = offset; index < offset + count; index++) {
        value = (value << 32n) + BigInt(array[offset]);
    }
    return value;
}

export class CXXRTLSample {
    constructor(
        public readonly time: TimePoint,
        private readonly valuesArray: Uint32Array,
        private readonly designations: ICXXRTLDesignation[]
    ) {}

    public values(): Map<ICXXRTLDesignation, bigint> {
        const values = new Map();
        let offset = 0;
        for (const designation of this.designations) {
            let widthInChunks = chunksFor(designation.item.width);
            if (designation instanceof CXXRTLNodeDesignation) {
                values.set(designation, getChunksAt(this.valuesArray, offset, widthInChunks));
                offset += widthInChunks;
            } else {
                throw new Error(`Cannot process ${designation}`);
            }
        }
        return values;
    }
}

export class CXXRTLConnection {
    private connection: cxxrtlServer.Connection;

    constructor(link: cxxrtlLink.ILink) {
        this.connection = new cxxrtlServer.Connection(link);
        this.connection.onEvent = async (event) => {
            console.log("event received", event);
        };
    }

    public dispose(): void {
        this.connection.dispose();
    }

    public async listScopes(): Promise<string[]> {
        const response = await this.connection.listScopes({
            type: 'command',
            command: 'list_scopes'
        });
        return Object.keys(response.scopes);
    }

    public async listItems(scope: string | null): Promise<Map<string, CXXRTLDebugItem>> {
        const response = await this.connection.listItems({
            type: 'command',
            command: 'list_items',
            scope
        });
        return new Map(Object.entries(response.items).map(([name, itemDesc]: [string, any]) => {
            const debugItem = new CXXRTLDebugItem(name, itemDesc.type, itemDesc.width, itemDesc.lsb_at, itemDesc.depth, itemDesc.zero_at);
            for (const rawSrc of (<{src: string}>itemDesc).src?.split('|') ?? []) {
                const sourceLocation = YosysSourceLocation.parse(rawSrc);
                if (sourceLocation !== null) {
                    debugItem.sourceLocations.push(sourceLocation);
                }
            }
            return [name, debugItem];
        }));
    }

    public async referenceItems(name: string, designations: ICXXRTLDesignation[]): Promise<ICXXRTLReference> {
        await this.connection.referenceItems({
            type: 'command',
            command: 'reference_items',
            reference: name,
            items: designations.map((x) => x.toJSON())
        });
        return new CXXRTLReference(name, designations);
    }

    public async queryInterval(begin: TimePoint, end: TimePoint, reference: ICXXRTLReference): Promise<CXXRTLSample[]> {
        const response = await this.connection.queryInterval({
            type: 'command',
            command: 'query_interval',
            interval: new TimeInterval(begin, end).toJSON(),
            collapse: true,
            items: reference.name,
            item_values_encoding: 'base64(u32)',
            diagnostics: false
        });
        const samples = [];
        for (const rawSamples of response.samples) {
            const time = TimePoint.fromJSON(rawSamples.time);
            const rawValues = Buffer.from(rawSamples.item_values!, 'base64');
            const valuesArray = new Uint32Array(rawValues.buffer, rawValues.byteOffset, rawValues.length / Uint32Array.BYTES_PER_ELEMENT);
            samples.push(new CXXRTLSample(time, valuesArray, (<CXXRTLReference>reference).designations));
        }
        return samples;
    }

    public async getSimulationStatus(): Promise<{ status: CXXRTLSimulationStatus, latestTime: TimePoint }> {
        const response = await this.connection.getSimulationStatus({
            type: 'command',
            command: 'get_simulation_status',
        });
        return { status: response.status as CXXRTLSimulationStatus, latestTime: TimePoint.fromJSON(response.latest_time) };
    }

    public async runSimulation({ untilTime, sampleItemValues = true }: { untilTime?: TimePoint, sampleItemValues?: boolean } = {}): Promise<void> {
        await this.connection.runSimulation({
            type: 'command',
            command: 'run_simulation',
            until_time: untilTime?.toJSON() ?? null,
            until_diagnostics: [],
            sample_item_values: sampleItemValues,
        });
    }

    public async pauseSimulation(): Promise<TimePoint> {
        const response = await this.connection.pauseSimulation({
            type: 'command',
            command: 'pause_simulation',
        });
        return TimePoint.fromJSON(response.time);
    }
}
