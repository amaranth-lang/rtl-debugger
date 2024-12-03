import * as link from './link';
import * as proto from './proto';

export class CommandError extends Error {
    constructor(public readonly errorPacket: proto.Error) {
        super(`command returned '${errorPacket.error}': ${errorPacket.message}`);
    }
}

export enum ConnectionState {
    Initializing = 'initializing',
    Connected = 'connected',
    Disconnected = 'disconnected',
}

// Note that we trust that server returns well-formed JSON. It would take far too much time to
// verify its adherence to the schema here, for little gain.
export class Connection {
    private readonly link: link.ILink;

    private _state = ConnectionState.Initializing;

    private _commands: string[] = [];
    private _events: string[] = [];
    private _itemValuesEncodings: string[] = [];

    private promises: {
        resolve: (response: link.Packet<proto.AnyResponse>) => void;
        reject: (error: Error) => void;
    }[] = [];
    private timestamps: Date[] = [];

    private sendIndex: number = 0;
    private recvIndex: number = 0;

    constructor(link_: link.ILink) {
        this.link = link_;
        this.link.onRecv = this.onLinkRecv.bind(this);
        this.link.onDone = this.onLinkDone.bind(this);
        this.send(link.Packet.fromObject({
            type: 'greeting',
            version: 0,
        }));
    }

    dispose(): void {
        this.link.dispose();
    }

    private traceSend(linkPacket: link.Packet<proto.ClientPacket>) {
        const packet = linkPacket.asObject();
        if (packet.type === 'greeting') {
            console.debug('[CXXRTL] C>S', packet);
        } else if (packet.type === 'command') {
            this.timestamps.push(new Date());
            console.debug(`[CXXRTL] C>S#${this.sendIndex++}`, packet);
        }
    }

    private traceRecv(linkPacket: link.Packet<proto.ServerPacket>) {
        const packet = linkPacket.asObject();
        if (packet.type === 'greeting') {
            console.debug('[CXXRTL] S>C', packet);
        } else if (packet.type === 'response') {
            const elapsed = new Date().getTime() - this.timestamps.shift()!.getTime();
            console.debug(`[CXXRTL] S>C#${this.recvIndex++}`, packet, `(${elapsed}ms)`);
        } else if (packet.type === 'error') {
            this.timestamps.shift();
            console.error(`[CXXRTL] S>C#${this.recvIndex++}`, packet);
        } else if (packet.type === 'event') {
            console.debug('[CXXRTL] S>C', packet);
        }
    }

    private async send(linkPacket: link.Packet<proto.ClientPacket>): Promise<void> {
        this.traceSend(linkPacket);
        if (this._state === ConnectionState.Disconnected) {
            throw new Error('unable to send packet after link is shutdown');
        } else {
            this.link.send(linkPacket);
        }
    }

    private async onLinkRecv(linkPacket: link.Packet<proto.ServerPacket>): Promise<void> {
        this.traceRecv(linkPacket);
        const packet = linkPacket.asObject();
        if (this._state === ConnectionState.Initializing && packet.type === 'greeting') {
            if (packet.version === 0) {
                this._commands = packet.commands;
                this._events = packet.events;
                this._itemValuesEncodings = packet.features.item_values_encoding;
                this._state = ConnectionState.Connected;
                await this.onConnected(packet);
            } else {
                this.rejectPromises(new Error(`unexpected CXXRTL protocol version ${packet.version}`));
            }
        } else if (this._state === ConnectionState.Connected &&
                        (packet.type === 'response' || packet.type === 'error')) {
            const nextPromise = this.promises.shift();
            if (nextPromise !== undefined) {
                if (packet.type === 'response') {
                    nextPromise.resolve(link.Packet.fromObject(packet));
                } else {
                    nextPromise.reject(new CommandError(packet));
                }
            } else {
                this.rejectPromises(new Error(`unexpected '${packet.type}' reply with no commands queued`));
            }
        } else if (this._state === ConnectionState.Connected && packet.type === 'event') {
            await this.onEvent(link.Packet.fromObject(packet));
        } else {
            this.rejectPromises(new Error(`unexpected ${packet.type} packet received for ${this._state} connection`));
        }
    }

    private async onLinkDone(): Promise<void> {
        this.rejectPromises(new Error('commands will not receive a reply after link is done'));
        this._state = ConnectionState.Disconnected;
        await this.onDisconnected();
    }

    private rejectPromises(error: Error): void {
        for (const promise of this.promises.splice(0, this.promises.length)) {
            promise.reject(error);
        }
    }

    async exchange(command: link.Packet<proto.AnyCommand>): Promise<link.Packet<proto.AnyResponse>> {
        await this.send(command);
        return new Promise((resolve, reject) => {
            this.promises.push({ resolve, reject });
        });
    }

    async onConnected(greetingPacket: proto.ServerGreeting): Promise<void> {}

    async onDisconnected(): Promise<void> {}

    async onEvent(_event: link.Packet<proto.AnyEvent>): Promise<void> {}

    get state(): ConnectionState {
        return this._state;
    }

    get commands(): string[] {
        return this._commands.slice();
    }

    get events(): string[] {
        return this._events.slice();
    }

    get itemValuesEncodings(): string[] {
        return this._itemValuesEncodings.slice();
    }

    private async command<T extends proto.AnyResponse>(command: proto.AnyCommand): Promise<T> {
        const response = await this.exchange(link.Packet.fromObject(command));
        return response.cast<T>().asObject();
    }

    async listScopes(command: proto.CommandListScopes): Promise<proto.ResponseListScopes> {
        return this.command<proto.ResponseListScopes>(command);
    }

    async listItems(command: proto.CommandListItems): Promise<proto.ResponseListItems> {
        return this.command<proto.ResponseListItems>(command);
    }

    async referenceItems(command: proto.CommandReferenceItems): Promise<proto.ResponseReferenceItems> {
        return this.command<proto.ResponseReferenceItems>(command);
    }

    async queryInterval(command: proto.CommandQueryInterval): Promise<proto.ResponseQueryInterval> {
        return this.command<proto.ResponseQueryInterval>(command);
    }

    async getSimulationStatus(command: proto.CommandGetSimulationStatus): Promise<proto.ResponseGetSimulationStatus> {
        return this.command<proto.ResponseGetSimulationStatus>(command);
    }

    async runSimulation(command: proto.CommandRunSimulation): Promise<proto.ResponseRunSimulation> {
        return this.command<proto.ResponseRunSimulation>(command);
    }

    async pauseSimulation(command: proto.CommandPauseSimulation): Promise<proto.ResponsePauseSimulation> {
        return this.command<proto.ResponsePauseSimulation>(command);
    }
}
