import * as stream from 'node:stream';

import * as proto from './proto';

export interface ILink {
    dispose(): void;

    onRecv: (packet: proto.ServerPacket) => Promise<void>;
    onDone: () => Promise<void>;

    send(packet: proto.ClientPacket): Promise<void>;
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

    async onRecv(_serverPacket: proto.ServerPacket): Promise<void> {}

    async onDone(): Promise<void> {}

    async send(clientPacket: proto.ClientPacket): Promise<void> {
        if (this.conversation.length === 0) {
            throw new Error('premature end of conversation');
        }

        const [[expectedClient, expectedServer], ...restOfConversation] = this.conversation;

        if (JSON.stringify(clientPacket) === JSON.stringify(expectedClient)) {
            if (expectedServer instanceof Array) {
                for (const serverPacket of expectedServer) {
                    await this.onRecv(serverPacket);
                }
            } else {
                await this.onRecv(expectedServer);
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
        const packets: proto.ServerPacket[] = [];
        for (const packetText of packetTexts) {
            try {
                packets.push(JSON.parse(packetText) as proto.ServerPacket);
            } catch (error) {
                console.error('malformed JSON: ', packetText);
                this.stream.pause();
                return;
            }
        }

        // Finally, run the handler for each of the packets. If the handler blocks, don't wait for
        // its completion, but run the next handler anyway; this is because a handler can send
        // another client packet, causing `onStreamData` to be re-entered, anyway.
        for (const packet of packets) {
            (async (packet: proto.ServerPacket) => {
                try {
                    await this.onRecv(packet);
                } catch (error) {
                    console.error('uncaught error in onRecv', error);
                }
            })(packet);
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

    async onRecv(_serverPacket: proto.ServerPacket): Promise<void> {}

    async onDone(): Promise<void> {}

    async send(clientPacket: proto.ClientPacket): Promise<void> {
        this.stream.write(JSON.stringify(clientPacket) + '\0');
    }
}
