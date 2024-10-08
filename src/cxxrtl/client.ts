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
    private _state = ConnectionState.Initializing;

    private _commands: string[] = [];
    private _events: string[] = [];
    private _itemValuesEncodings: string[] = [];

    private promises: {
        resolve: (response: proto.AnyResponse) => void;
        reject: (error: Error) => void;
    }[] = [];
    private timestamps: Date[] = [];

    private sendIndex: number = 0;
    private recvIndex: number = 0;

    constructor(private readonly link: link.ILink) {
        this.link.onRecv = this.onLinkRecv.bind(this);
        this.link.onDone = this.onLinkDone.bind(this);
        this.send({
            type: 'greeting',
            version: 0,
        });
    }

    public dispose(): void {
        this.link.dispose();
    }

    private traceSend(packet: proto.ClientPacket) {
        this.timestamps.push(new Date());
        if (packet.type === 'greeting') {
            console.debug(`[CXXRTL] C>S`, packet);
        } else if (packet.type === 'command') {
            console.debug(`[CXXRTL] C>S#${this.sendIndex++}`, packet);
        }
    }

    private traceRecv(packet: proto.ServerPacket) {
        if (packet.type === 'greeting') {
            console.debug(`[CXXRTL] S>C`, packet);
        } else if (packet.type === 'response') {
            const elapsed = new Date().getTime() - this.timestamps.shift()!.getTime();
            console.debug(`[CXXRTL] S>C#${this.recvIndex++}`, packet, `(${elapsed}ms)`);
        } else if (packet.type === 'error') {
            this.timestamps.shift();
            console.error(`[CXXRTL] S>C#${this.recvIndex++}`, packet);
        } else if (packet.type === 'event') {
            console.debug(`[CXXRTL] S>C`, packet);
        }
    }

    private async send(packet: proto.ClientPacket): Promise<void> {
        this.traceSend(packet);
        if (this._state === ConnectionState.Disconnected) {
            throw new Error('unable to send packet after link is shutdown');
        } else {
            this.link.send(packet);
        }
    }

    private async onLinkRecv(packet: proto.ServerPacket): Promise<void> {
        this.traceRecv(packet);
        if (this._state === ConnectionState.Initializing && packet.type === 'greeting') {
            if (packet.version === 0) {
                this._commands = packet.commands;
                this._events = packet.events;
                this._itemValuesEncodings = packet.features.item_values_encoding;
                this._state = ConnectionState.Connected;
                await this.onConnected();
            } else {
                this.rejectPromises(new Error(`unexpected CXXRTL protocol version ${packet.version}`));
            }
        } else if (this._state === ConnectionState.Connected &&
                        (packet.type === 'response' || packet.type === 'error')) {
            const nextPromise = this.promises.shift();
            if (nextPromise !== undefined) {
                if (packet.type === 'response') {
                    nextPromise.resolve(packet);
                } else {
                    nextPromise.reject(new CommandError(packet));
                }
            } else {
                this.rejectPromises(new Error(`unexpected '${packet.type}' reply with no commands queued`));
            }
        } else if (this._state === ConnectionState.Connected && packet.type === 'event') {
            await this.onEvent(packet);
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

    private async perform(command: proto.AnyCommand): Promise<proto.AnyResponse> {
        await this.send(command);
        return new Promise((resolve, reject) => {
            this.promises.push({ resolve, reject });
        });
    }

    public async onConnected(): Promise<void> {}

    public async onDisconnected(): Promise<void> {}

    public async onEvent(_event: proto.AnyEvent): Promise<void> {}

    public get state(): ConnectionState {
        return this._state;
    }

    public get commands(): string[] {
        return this._commands.slice();
    }

    public get events(): string[] {
        return this._events.slice();
    }

    public get itemValuesEncodings(): string[] {
        return this._itemValuesEncodings.slice();
    }

    public async listScopes(command: proto.CommandListScopes): Promise<proto.ResponseListScopes> {
        return await this.perform(command) as proto.ResponseListScopes;
    }

    public async listItems(command: proto.CommandListItems): Promise<proto.ResponseListItems> {
        return await this.perform(command) as proto.ResponseListItems;
    }

    public async referenceItems(command: proto.CommandReferenceItems): Promise<proto.ResponseReferenceItems> {
        return await this.perform(command) as proto.ResponseReferenceItems;
    }

    public async queryInterval(command: proto.CommandQueryInterval): Promise<proto.ResponseQueryInterval> {
        return await this.perform(command) as proto.ResponseQueryInterval;
    }

    public async getSimulationStatus(command: proto.CommandGetSimulationStatus): Promise<proto.ResponseGetSimulationStatus> {
        return await this.perform(command) as proto.ResponseGetSimulationStatus;
    }

    public async runSimulation(command: proto.CommandRunSimulation): Promise<proto.ResponseRunSimulation> {
        return await this.perform(command) as proto.ResponseRunSimulation;
    }

    public async pauseSimulation(command: proto.CommandPauseSimulation): Promise<proto.ResponsePauseSimulation> {
        return await this.perform(command) as proto.ResponsePauseSimulation;
    }
}
