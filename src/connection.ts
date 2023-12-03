import * as stream from 'stream';

const PROTOCOL_VERSION: number = 0;

export interface ICXXRTLAgentError {
    name: string;
    message: string;
}

export interface ICXXRTLAgentCapabilities {
    commands: string[];
    events: string[];
}

export enum CXXRTLDebugItemType {
    Node = "node",
    Memory = "memory"
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

export interface ICXXRTLDebugItem {
    src: ICXXRTLSourceLocation[];
    type: CXXRTLDebugItemType;
    width: number;
    lsb_at: number;
    depth: number;
    zero_at: number;
}

export class CXXRTLConnection {
    constructor(
        private readonly stream: stream.Duplex,
        private onServerError?: (error: ICXXRTLAgentError) => void,
        private onClientError?: (error: Error) => void
    ) {
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
        throw new Error(`server returned an error: ${packet.error} (${packet.message})`);
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
        return new Promise((resolve, reject) => {
            const stream = this.stream;
            const buffer: string[] = [];
            function onData(data: string) {
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
            }
            function onError(error: any) {
                reject(error);
                // Remove the callbacks.
                stream.off('data', onData);
                stream.off('error', onError);
            }
            this.stream.on('data', onData);
            this.stream.on('error', onError);
        });
    }

    private async recvGreeting(): Promise<any> {
        const response = await this.recvPacket();
        if (response.type === 'greeting') {
            return response;
        } else if (response.type === 'error') {
            this.serverError(response);
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
            return this.recvResponse();
        } else if (response.type === 'error') {
            await this.serverError(response);
        } else {
            await this.clientError(new Error(`Expected a response packet, received a ${response.type} packet instead`));
        }
    }

    private performCommand(packet: any): Promise<any> {
        this.sendPacket(packet);
        return this.recvResponse();
    }

    public async exchangeGreeting(): Promise<ICXXRTLAgentCapabilities> {
        await this.sendPacket({
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

    public async listItems(scope: string | null): Promise<Map<string, ICXXRTLDebugItem>> {
        const response = await this.performCommand({
            type: 'command',
            command: 'list_items',
            scope: scope
        });
        return new Map(Object.entries(response.items).map(([name, itemDesc]: [string, any]) => {
            const rawItems: string[] = itemDesc.src?.split('|') ?? [];
            itemDesc.src = rawItems
                .map(YosysSourceLocation.parse)
                .filter((item) => item !== null);
            return [name, itemDesc];
        }));
    }
}