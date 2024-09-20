import * as wire from './wire';
import { ILink } from './link';

type CommandPromise = {
    resolve: (response: wire.AnyResponse | wire.Error) => void;
    reject: (error: Error) => void;
};

export enum ConnectionState {
    Created,
    Ready,
    Done,
}

export class Connection {
    private state = ConnectionState.Created;

    private commandList: string[] = [];
    private eventList: string[] = [];
    private itemValuesEncodingList: string[] = [];

    private promises: CommandPromise[] = [];

    constructor(private readonly link: ILink) {
        link.onRecv = this.onLinkRecv;
        link.onFail = this.onLinkFail;
        link.onDone = this.onLinkDone;
    }

    private async send(packet: wire.ClientPacket): Promise<void> {
        console.log("[RTL Debugger] C>S:", packet);
        if (this.state === ConnectionState.Done) {
            throw new Error("unable to send packet after link shutdown");
        } else {
            this.link.send(packet);
        }
    }

    private async onLinkRecv(packet: wire.ServerPacket): Promise<void> {
        console.log("[RTL Debugger] S>C:", packet);
        if (this.state === ConnectionState.Created && packet.type === "greeting") {
            if (packet.version !== 0) {
                throw new Error(`unexpected CXXRTL protocol version ${packet.version}`);
            }
            this.commandList = packet.commands;
            this.eventList = packet.events;
            this.itemValuesEncodingList = packet.features.item_values_encoding;
            this.state = ConnectionState.Ready;
            await this.onStateChange(this.state);
        } else if (this.state === ConnectionState.Ready &&
                        (packet.type === "response" || packet.type === "error")) {
            const nextPromise = this.promises.shift();
            if (nextPromise === undefined) {
                throw new Error("unexpected reply with no commands queued");
            }
            nextPromise.resolve(packet);
        } else if (this.state === ConnectionState.Ready && packet.type === "event") {
            await this.onEvent(packet);
        } else {
            throw new Error(`unexpected ${packet.type} packet received for ${this.state} connection`);
        }
    }

    private async onLinkFail(error: Error): Promise<void> {
        console.log("[RTL Debugger] C!S:", error);
        for (const commandPromise of this.promises) {
            commandPromise.reject(error);
        }
        this.promises.splice(0, this.promises.length);
    }

    private async onLinkDone(): Promise<void> {
        console.log("[RTL Debugger] C.S: done");
        this.state = ConnectionState.Done;
        await this.onStateChange(this.state);
    }

    get commands(): string[] {
        return this.commandList;
    }

    get events(): string[] {
        return this.eventList;
    }

    get itemValuesEncodings(): string[] {
        return this.itemValuesEncodingList;
    }

    async runCommand(command: wire.AnyCommand): Promise<wire.AnyResponse | wire.Error> {
        await this.send(command);
        return new Promise((resolve, reject) => {
            this.promises.push({ resolve, reject });
        });
    }

    async onStateChange(_state: ConnectionState): Promise<void> {}

    async onEvent(_event: wire.AnyEvent): Promise<void> {}
}
