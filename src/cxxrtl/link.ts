import * as stream from 'node:stream';

import * as proto from './proto';

// Lazily serialize/deserialize packets in case they only need to be passed along.
export class Packet<T> {
    private constructor(
        private serialized: string | undefined,
        private deserialized: T | undefined,
    ) { }

    static fromString<T>(serialized: string) {
        return new Packet<T>(serialized, undefined);
    }

    static fromObject<T>(deserialized: T) {
        return new Packet<T>(undefined, deserialized);
    }

    asString(): string {
        if (this.serialized === undefined) {
            this.serialized = JSON.stringify(this.deserialized!);
        }
        return this.serialized;
    }

    asObject(): T {
        if (this.deserialized === undefined) {
            this.deserialized = <T>JSON.parse(this.serialized!);
        }
        return this.deserialized;
    }

    cast<U>(): Packet<U> {
        return <Packet<U>>(<unknown>(this));
    }

    // Make sure we don't unintentionally negate the performance advantages of this wrapper.
    toJSON(): never {
        throw new Error('call Packet.asObject() instead of serializing with JSON.stringify()');
    }
}

export interface ILink {
    dispose(): void;

    onRecv: (packet: Packet<proto.ServerPacket>) => Promise<void>;
    onDone: () => Promise<void>;

    send(packet: Packet<proto.ClientPacket>): Promise<void>;
}

export class MockLink implements ILink {
    constructor(
        private conversation: [proto.ClientPacket, proto.ServerPacket | proto.ServerPacket[]][]
    ) {}

    dispose(): void {
        if (this.conversation.length !== 0) {
            throw new Error('disposed of before end of conversation');
        }
    }

    async onRecv(_serverPacket: Packet<proto.ServerPacket>): Promise<void> {}

    async onDone(): Promise<void> {}

    async send(clientPacket: Packet<proto.ClientPacket>): Promise<void> {
        if (this.conversation.length === 0) {
            throw new Error('premature end of conversation');
        }

        const [[expectedClient, expectedServer], ...restOfConversation] = this.conversation;

        if (clientPacket.asString() === JSON.stringify(expectedClient)) {
            if (expectedServer instanceof Array) {
                for (const serverPacket of expectedServer) {
                    await this.onRecv(Packet.fromObject(serverPacket));
                }
            } else {
                await this.onRecv(Packet.fromObject(expectedServer));
            }
        } else {
            console.error('unexpected client packet', clientPacket, '; expected:', expectedClient);
            throw new Error('unexpected client packet');
        }

        if (restOfConversation.length === 0) {
            await this.onDone();
        }

        this.conversation = restOfConversation;
    }
}

export class NodeStreamLink implements ILink {
    private recvBuffer: string[] = [];

    constructor(private readonly stream: stream.Duplex) {
        stream.on('data', this.onStreamData.bind(this));
        stream.on('end', this.onStreamEnd.bind(this));
        stream.setEncoding('utf-8');
    }

    private async onStreamData(chunk: string): Promise<void> {
        // First, split off complete packets and buffer the rest. This shouldn't ever throw errors;
        // if it did, the reader could get desynchronized from the protocol.
        const packetTexts: string[] = [];
        const [first, ...rest] = chunk.split('\0');
        this.recvBuffer.push(first);
        if (rest.length > 0) {
            packetTexts.push(this.recvBuffer.join(''));
            rest.forEach((packetText, index) => {
                if (index < rest.length - 1) {
                    packetTexts.push(packetText);
                }
            });
            this.recvBuffer.splice(0, this.recvBuffer.length, rest.at(-1)!);
        }

        // Second, convert the packet text to JSON. This can throw errors e.g. if there is foreign
        // data injected between server replies, or the server is malfunctioning. In that case,
        // stop processing input.
        const packets: Packet<proto.ServerPacket>[] = [];
        for (const packetText of packetTexts) {
            packets.push(Packet.fromString<proto.ServerPacket>(packetText));
        }

        // Finally, run the handler for each of the packets. If the handler blocks, don't wait for
        // its completion, but run the next handler anyway; this is because a handler can send
        // another client packet, causing `onStreamData` to be re-entered, anyway.
        for (const packet of packets) {
            const success = (async (packet) => {
                try {
                    await this.onRecv(packet);
                    return true;
                } catch (error) {
                    console.error('uncaught error in onRecv', error);
                    this.stream.pause();
                    return false;
                }
            })(packet);
            if (!success) {
                break;
            }
        }
    }

    private async onStreamEnd(): Promise<void> {
        try {
            await this.onDone();
        } catch (error) {
            console.error('uncaught error in onDone', error);
        }
    }

    dispose(): void {
        this.stream.destroy();
    }

    async onRecv(_serverPacket: Packet<proto.ServerPacket>): Promise<void> {}

    async onDone(): Promise<void> {}

    async send(clientPacket: Packet<proto.ClientPacket>): Promise<void> {
        this.stream.write(clientPacket.asString());
        this.stream.write('\0');
    }
}
