import * as stream from 'stream';
import { TimeInterval, TimePoint } from './time';

const PROTOCOL_VERSION: number = 0;

export interface ICXXRTLAgentError {
    name: string;
    message: string;
}

export interface ICXXRTLAgentCapabilities {
    commands: string[];
    events: string[];
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
    Running = "running",
    Paused = "paused",
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
    private packetInFlight: Promise<void> = Promise.resolve();

    constructor(
        private readonly stream: stream.Duplex,
        private onServerError?: (error: ICXXRTLAgentError) => void,
        private onClientError?: (error: Error) => void
    ) {
        this.stream = stream;
        this.stream.setEncoding('utf-8');
    }

    public dispose(): void {
        this.stream.destroy();
    }

    private async serverError(packet: any): Promise<void> {
        if (this.onServerError) {
            this.onServerError({
                name: packet.error,
                message: packet.message
            });
        }
        throw new Error(`Server returned an error: ${packet.error} (${packet.message})`);
    }

    private async clientError(error: Error): Promise<void> {
        if (this.onClientError) {
            this.onClientError(error);
        }
        throw error;
    }

    private sendPacket(packet: any) {
        console.log("[CXXRTL Debugger] C>S:", packet);
        this.stream.write(JSON.stringify(packet) + '\0');
    }

    private recvPacket(): Promise<any> {
        return (this.packetInFlight = new Promise((resolve, reject) => {
            const stream = this.stream;
            const buffer: string[] = [];
            const onData = (data: string) => {
                // Process the packet.
                const packetEndIndex = data.indexOf('\0');
                if (packetEndIndex === -1) {
                    buffer.push(data);
                    return;
                } else {
                    const beforePacketEnd = data.substring(0, packetEndIndex);
                    const afterPacketEnd = data.substring(packetEndIndex + 1);
                    buffer.push(beforePacketEnd);
                    if (afterPacketEnd !== '') {
                        stream.unshift(afterPacketEnd);
                    }
                }
                // At this point, we have a complete packet in chunks inside `buffer`.
                const packet = JSON.parse(buffer.join(''));
                console.log("[CXXRTL Debugger] S>C:", packet);
                resolve(packet);
                // Remove the callbacks.
                stream.off('data', onData);
                stream.off('error', onError);
                stream.off('end', onError);
            };
            const onError = (error: any) => {
                reject(error ?? new Error(`The CXXRTL server has suddenly disconnected.`));
                // Remove the callbacks.
                stream.off('data', onData);
                stream.off('error', onError);
                stream.off('end', onError);
            };
            stream.on('data', onData);
            stream.on('error', onError);
            stream.on('end', onError);
        }));
    }

    private async recvGreeting(): Promise<any> {
        const response = await this.recvPacket();
        if (response.type === 'greeting') {
            return response;
        } else if (response.type === 'error') {
            await this.serverError(response);
        } else {
            await this.clientError(new Error(`Expected a greeting packet, received a ${response.type} packet instead`));
        }
    }

    private async recvResponse(): Promise<any> {
        const response = await this.recvPacket();
        if (response.type === 'response') {
            return response;
        } else if (response.type === 'event') {
            // TODO: process event
            return await this.recvResponse();
        } else if (response.type === 'error') {
            await this.serverError(response);
        } else {
            await this.clientError(new Error(`Expected a response packet, received a ${response.type} packet instead`));
        }
    }

    private async performCommand(packet: any): Promise<any> {
        await this.packetInFlight; // wait for response to be received before sending next command
        this.sendPacket(packet);
        return this.recvResponse();
    }

    public async exchangeGreeting(): Promise<ICXXRTLAgentCapabilities> {
        this.sendPacket({
            type: 'greeting',
            version: PROTOCOL_VERSION
        });
        const response = await this.recvGreeting();
        if (response.version !== PROTOCOL_VERSION) {
            await this.clientError(new Error(`The server version is not ${PROTOCOL_VERSION}.`));
        }
        return {
            commands: response.commands,
            events: response.events
        };
    }

    public async listScopes(): Promise<string[]> {
        const response = await this.performCommand({
            type: 'command',
            command: 'list_scopes'
        });
        return Object.keys(response.scopes);
    }

    public async listItems(scope: string | null): Promise<Map<string, CXXRTLDebugItem>> {
        const response = await this.performCommand({
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
        await this.performCommand({
            type: 'command',
            command: 'reference_items',
            reference: name,
            items: designations
        });
        return new CXXRTLReference(name, designations);
    }

    public async queryInterval(begin: TimePoint, end: TimePoint, reference: ICXXRTLReference): Promise<CXXRTLSample[]> {
        const response = await this.performCommand({
            type: 'command',
            command: 'query_interval',
            interval: new TimeInterval(begin, end),
            collapse: true,
            items: reference.name,
            item_values_encoding: 'base64(u32)',
            diagnostics: false
        });
        const samples = [];
        for (const rawSamples of response.samples) {
            const time = TimePoint.fromJSON(rawSamples.time);
            const rawValues = Buffer.from(rawSamples.item_values, 'base64');
            const valuesArray = new Uint32Array(rawValues.buffer, rawValues.byteOffset, rawValues.length / Uint32Array.BYTES_PER_ELEMENT);
            samples.push(new CXXRTLSample(time, valuesArray, (<CXXRTLReference>reference).designations));
        }
        return samples;
    }

    public async getSimulationStatus(): Promise<{ status: CXXRTLSimulationStatus, latestTime: TimePoint }> {
        const response = await this.performCommand({
            type: 'command',
            command: 'get_simulation_status',
        });
        return { status: response.status, latestTime: TimePoint.fromJSON(response.latest_time) };
    }

    public async runSimulation({ untilTime, sampleItemValues = true }: { untilTime?: TimePoint, sampleItemValues?: boolean } = {}): Promise<void> {
        await this.performCommand({
            type: 'command',
            command: 'run_simulation',
            until_time: untilTime?.toJSON() ?? null,
            sample_item_values: sampleItemValues,
        });
    }

    public async pauseSimulation(): Promise<TimePoint> {
        const response = await this.performCommand({
            type: 'command',
            command: 'pause_simulation',
        });
        return TimePoint.fromJSON(response.time);
    }
}