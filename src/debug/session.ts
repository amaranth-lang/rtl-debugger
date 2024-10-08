import * as vscode from 'vscode';

import * as proto from '../cxxrtl/proto';
import { ILink } from '../cxxrtl/link';
import { Connection } from '../cxxrtl/client';
import { TimeInterval, TimePoint } from '../model/time';
import { Reference, Sample, UnboundReference } from '../model/sample';
import { Variable } from '../model/variable';
import { Scope } from '../model/scope';

function lazy<T>(thunk: () => Thenable<T>): Thenable<T> {
    return { then: (onfulfilled, onrejected) => thunk().then(onfulfilled, onrejected) };
}

export interface ISimulationStatus {
    status: 'running' | 'paused' | 'finished';
    latestTime: TimePoint;
    nextSampleTime?: TimePoint;
}

export class Session {
    private connection: Connection;

    constructor(link: ILink) {
        this.connection = new Connection(link);
        this.connection.onEvent = async (event) => {
            if (event.event === 'simulation_paused' || event.event === 'simulation_finished') {
                await this.querySimulationStatus();
            }
        };
        this.querySimulationStatus(); // populate nextSampleTime
    }

    dispose() {
        this.connection.dispose();
    }

    get connection2(): Connection {
        return this.connection;
    }

    // ======================================== Inspecting the design

    private itemCache: Map<string, proto.ItemDescriptionMap> = new Map();
    private scopeCache: Map<string, proto.ScopeDescriptionMap> = new Map();
    private rootScopeDesc: proto.ScopeDescription | undefined;

    private async listItemsInScope(scopeIdentifier: string): Promise<proto.ItemDescriptionMap> {
        let itemDescriptionMap = this.itemCache.get(scopeIdentifier);
        if (itemDescriptionMap === undefined) {
            const response = await this.connection.listItems({
                type: 'command',
                command: 'list_items',
                scope: scopeIdentifier,
            });
            itemDescriptionMap = response.items;
            this.itemCache.set(scopeIdentifier, itemDescriptionMap);
        }
        return itemDescriptionMap;
    }

    private async listScopesInScope(scopeIdentifier: string): Promise<proto.ScopeDescriptionMap> {
        let scopeDescriptionMap = this.scopeCache.get(scopeIdentifier);
        if (scopeDescriptionMap === undefined) {
            const response = await this.connection.listScopes({
                type: 'command',
                command: 'list_scopes'
                // FIXME: should be possible to filter by scope, too
            });
            const filteredScopes = Object.keys(response.scopes).filter((scopeName) => {
                if (scopeIdentifier === '') {
                    return scopeName.length > 0 && scopeName.indexOf(' ') === -1;
                } else {
                    return (scopeName.startsWith(scopeIdentifier + ' ') &&
                        scopeName.indexOf(' ', scopeIdentifier.length + 1) === -1);
                }
            });
            scopeDescriptionMap = Object.fromEntries(filteredScopes.map((scopeName) =>
                [scopeName, response.scopes[scopeName]]));
            this.scopeCache.set(scopeIdentifier, scopeDescriptionMap);
        }
        return scopeDescriptionMap;
    }

    async getVariablesIn(scopeIdentifier: string): Promise<Variable[]> {
        const items = await this.listItemsInScope(scopeIdentifier);
        return Object.entries(items).map(([itemName, itemDesc]) =>
            Variable.fromCXXRTL(itemName, itemDesc));
    }

    async getScopesIn(scopeIdentifier: string): Promise<Scope[]> {
        const scopes = await this.listScopesInScope(scopeIdentifier);
        return Object.entries(scopes).map(([scopeName, scopeDesc]) =>
            Scope.fromCXXRTL(
                scopeName,
                scopeDesc,
                lazy(() => this.getScopesIn(scopeName)),
                lazy(() => this.getVariablesIn(scopeName)),
            ));
    }

    async getRootScope(): Promise<Scope> {
        const scopeName = '';
        if (this.rootScopeDesc === undefined) {
            const response = await this.connection.listScopes({
                type: 'command',
                command: 'list_scopes'
            });
            this.rootScopeDesc = response.scopes[scopeName];
        }
        return Scope.fromCXXRTL(
            scopeName,
            this.rootScopeDesc,
            lazy(() => this.getScopesIn(scopeName)),
            lazy(() => this.getVariablesIn(scopeName))
        );
    }

    async getVariable(variableIdentifier: string): Promise<Variable | null> {
        const identifierParts = variableIdentifier.split(' ');
        const scopeIdentifier = identifierParts.slice(0, identifierParts.length - 1).join(' ');
        const items = await this.listItemsInScope(scopeIdentifier);
        if (variableIdentifier in items) {
            return Variable.fromCXXRTL(variableIdentifier, items[variableIdentifier]);
        } else {
            return null;
        }
    }

    // ======================================== Querying the database

    private referenceEpochs: Map<string, number> = new Map();

    private advanceReferenceEpoch(name: string): number {
        const epoch = (this.referenceEpochs.get(name) || 0) + 1;
        this.referenceEpochs.set(name, epoch);
        return epoch;
    }

    private checkReferenceEpoch(name: string, requestedEpoch: number) {
        const currentEpoch = this.referenceEpochs.get(name);
        if (currentEpoch === undefined) {
            throw new ReferenceError(
                `Querying dangling reference ${name}#${requestedEpoch}`);
        } else if (currentEpoch !== requestedEpoch) {
            throw new ReferenceError(
                `Querying out-of-date reference ${name}#${requestedEpoch}; ` +
                `the current binding is ${name}#${currentEpoch}`);
        }
    }

    bindReference(name: string, reference: UnboundReference): Reference {
        const epoch = this.advanceReferenceEpoch(name);
        // Note that we do not wait for the command to complete. Although it is possible for
        // the command to fail, this would only happen if one of the designations is invalid,
        // which should never happen absent bugs. We still report the error in that case.
        this.connection.referenceItems({
            type: 'command',
            command: 'reference_items',
            reference: name,
            items: reference.cxxrtlItemDesignations()
        }).catch((error) => {
            console.error('[CXXRTL] Invalid designation while binding reference', `${name}#${epoch}`, error);
        });
        return new Reference(name, epoch, reference);
    }

    async queryInterval(
        interval: TimeInterval,
        reference: Reference,
        options: { collapse?: boolean } = {}
    ): Promise<Sample[]> {
        this.checkReferenceEpoch(reference.name, reference.epoch);
        const response = await this.connection.queryInterval({
            type: 'command',
            command: 'query_interval',
            interval: interval.toCXXRTL(),
            collapse: options.collapse ?? true,
            items: reference.name,
            item_values_encoding: 'base64(u32)',
            diagnostics: false
        });
        return response.samples.map((cxxrtlSample) => {
            const itemValuesBuffer = Buffer.from(cxxrtlSample.item_values!, 'base64');
            const itemValuesArray = new Uint32Array(
                itemValuesBuffer.buffer,
                itemValuesBuffer.byteOffset,
                itemValuesBuffer.length / Uint32Array.BYTES_PER_ELEMENT
            );
            return new Sample(
                TimePoint.fromCXXRTL(cxxrtlSample.time),
                reference.unbound,
                itemValuesArray
            );
        });
    }

    // ======================================== Manipulating the simulation

    private simulationStatusTimeout: NodeJS.Timeout | null = null;

    private _onDidChangeSimulationStatus: vscode.EventEmitter<ISimulationStatus> = new vscode.EventEmitter<ISimulationStatus>();
    readonly onDidChangeSimulationStatus: vscode.Event<ISimulationStatus> = this._onDidChangeSimulationStatus.event;

    private _simulationStatus: ISimulationStatus = {
        status: 'paused',
        latestTime: TimePoint.ZERO,
    };

    get simulationStatus() {
        return this._simulationStatus;
    }

    private async querySimulationStatus(): Promise<void> {
        if (this.simulationStatusTimeout !== null) {
            clearTimeout(this.simulationStatusTimeout);
            this.simulationStatusTimeout = null;
        }
        const response = await this.connection.getSimulationStatus({
            type: 'command',
            command: 'get_simulation_status'
        });
        const currentSimulationStatus = {
            status: response.status,
            latestTime: TimePoint.fromCXXRTL(response.latest_time),
            nextSampleTime: (response.status === 'paused')
                ? TimePoint.fromCXXRTL(response.next_sample_time)
                : undefined,
        };
        if ((this._simulationStatus.status !== currentSimulationStatus.status) ||
                !this._simulationStatus.latestTime.equals(currentSimulationStatus.latestTime) ||
                // This part of the condition only fires once, when the initial status is updated.
                (this._simulationStatus.nextSampleTime === undefined &&
                    currentSimulationStatus.nextSampleTime !== undefined)) {
            this._simulationStatus = currentSimulationStatus;
            this._onDidChangeSimulationStatus.fire(this._simulationStatus);
        }
        if (currentSimulationStatus.status === 'running') {
            this.simulationStatusTimeout = setTimeout(() => this.querySimulationStatus(), 100);
        }
    }

    async runSimulation(options: { untilTime?: TimePoint } = {}): Promise<void> {
        await this.connection.runSimulation({
            type: 'command',
            command: 'run_simulation',
            until_time: options.untilTime?.toCXXRTL() ?? null,
            until_diagnostics: [],
            sample_item_values: true
        });
        await this.querySimulationStatus();
    }

    async pauseSimulation(): Promise<void> {
        await this.connection.pauseSimulation({
            type: 'command',
            command: 'pause_simulation'
        });
        await this.querySimulationStatus();
    }

    get isSimulationRunning(): boolean {
        return this._simulationStatus.status === 'running';
    }

    // ======================================== Manipulating the time cursor

    private _onDidChangeTimeCursor: vscode.EventEmitter<TimePoint> = new vscode.EventEmitter<TimePoint>();
    readonly onDidChangeTimeCursor: vscode.Event<TimePoint> = this._onDidChangeTimeCursor.event;

    private _timeCursor: TimePoint = TimePoint.ZERO;

    // We don't know how far forward the next time step will be; the server doesn't provide this
    // information. A typical simulation has a consistent time step, or at least a time step of
    // a consistent order of magnitude; we guess this time step using binary search and then look
    // ahead to find out the actual next cursor position. The advantage of this approach is that
    // the simulation can advance its timeline however it wants.
    private _forwardTimeStep: bigint = 1n; // in femtos

    get timeCursor() {
        return this._timeCursor;
    }

    set timeCursor(newTimeCursor: TimePoint) {
        if (newTimeCursor.lessThan(TimePoint.ZERO) ||
                newTimeCursor.greaterThan(this.simulationStatus.latestTime)) {
            throw new RangeError('Time cursor out of range');
        }
        this._timeCursor = newTimeCursor;
        this._onDidChangeTimeCursor.fire(this._timeCursor);
    }

    async stepForward(): Promise<TimePoint> {
        if (this.timeCursor.equals(this.simulationStatus.latestTime)) {
            if (this.simulationStatus.status === 'paused') {
                const nextSampleTime = this.simulationStatus.nextSampleTime!;
                await this.runSimulation({ untilTime: nextSampleTime });
                await this.querySimulationStatus();
                if (!nextSampleTime.greaterThan(this.simulationStatus.latestTime)) {
                    this.timeCursor = nextSampleTime;
                }
            }
        } else {
            while (true) {
                const followingTimePoint = this.timeCursor.offsetByFemtos(this._forwardTimeStep);
                const response = await this.connection.queryInterval({
                    type: 'command',
                    command: 'query_interval',
                    interval: new TimeInterval(this._timeCursor, followingTimePoint).toCXXRTL(),
                    collapse: true,
                    items: null,
                    item_values_encoding: null,
                    diagnostics: false
                });
                if (response.samples.length === 1) {
                    this._forwardTimeStep = this._forwardTimeStep * 2n;
                    continue;
                }
                this.timeCursor = TimePoint.fromCXXRTL(response.samples.at(1)!.time);
                break;
            }
        }
        return this.timeCursor;
    }

    async stepBackward(): Promise<TimePoint> {
        if (!this.timeCursor.equals(TimePoint.ZERO)) {
            const precedingTimePoint = this.timeCursor.offsetByFemtos(-1n);
            const response = await this.connection.queryInterval({
                type: 'command',
                command: 'query_interval',
                interval: new TimeInterval(precedingTimePoint, precedingTimePoint).toCXXRTL(),
                collapse: true,
                items: null,
                item_values_encoding: null,
                diagnostics: false
            });
            this.timeCursor = TimePoint.fromCXXRTL(response.samples.at(0)!.time);
        }
        return this.timeCursor;
    }
}
