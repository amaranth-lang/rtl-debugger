import * as stream from 'node:stream';

import * as wire from './wire';

export interface ILink {
    send(packet: wire.ClientPacket): Promise<void>;
    onRecv: (packet: wire.ServerPacket) => Promise<void>;
    onFail: (error: Error) => Promise<void>;
    onDone: () => Promise<void>;
};

export type MockConversationStanza =
[wire.ClientPacket, wire.ServerPacket | wire.ServerPacket[]];

export class MockLink implements ILink {
    constructor(private conversation: MockConversationStanza[]) {}

    async send(clientPacket: wire.ClientPacket): Promise<void> {
        if (this.conversation.length === 0) {
            throw new Error("premature end of conversation in mock link");
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
            console.error("unexpected client packet", clientPacket, "; expected:", expectedClient);
            throw new Error("unexpected client packet in mock link");
        }

        if (restOfConversation.length === 0) {
            await this.onDone();
        }

        this.conversation = restOfConversation;
    }

    async onRecv(_serverPacket: wire.ServerPacket): Promise<void> {
        throw new Error("must override onRecv");
    }

    async onFail(error: Error): Promise<void> {
        throw error;
    }

    async onDone(): Promise<void> {}
}

export class NodeStreamLink implements ILink {
    constructor(private readonly stream: stream.Duplex) {
        const handleRecv = async (packetText: string) => {
            try {
                const packet = JSON.parse(packetText) as wire.ServerPacket;
                await this.onRecv(packet);
            } catch (error) {
                // Not a particularly great way to handle error in `onRecv`, but we don't have
                // a better one.
                if (error instanceof Error) {
                    this.onFail(error);
                }
            }
        };

        const recvQueue: string[] = [];
        stream.on("data", (chunk: string) => {
            const [first, ...rest] = chunk.split("\0");
            recvQueue.push(first);
            if (rest.length > 0) {
                handleRecv(recvQueue.join());
                rest.forEach((packetText, index) => {
                    if (index < rest.length - 1) {
                        handleRecv(packetText);
                    }
                });
                recvQueue.splice(0, recvQueue.length, rest[-1]);
            }
        });
        stream.on("error", (error) => this.onFail(error));
        stream.on("end", () => this.onDone());
    }

    async send(clientPacket: wire.ClientPacket): Promise<void> {
        this.stream.write(JSON.stringify(clientPacket) + '\0');
    }

    async onRecv(_serverPacket: wire.ServerPacket): Promise<void> {
        throw new Error("must override onRecv");
    }

    async onFail(error: Error): Promise<void> {
        throw error;
    }

    async onDone(): Promise<void> {}
}
