// Refer to https://gist.github.com/whitequark/59520e2de0947da8747061bc2ea91639 for a general
// description of the CXXRTL protocol.

// # Message types

// ## Message type: Greeting

export type ClientGreeting = {
    type: 'greeting';
    version: 0;
};

export type ServerGreeting = {
    type: 'greeting';
    version: 0;
    commands: string[];
    events: string[];
    features: {
        item_values_encoding: string[];
    };
};

// ## Message type: Command

export type Command = {
    type: 'command';
    command: string;
    [argument: string]: any;
};

// ## Message type: Response

export type Response = {
    type: 'command';
    command: string;
    [argument: string]: any;
};

export type Error = {
    type: 'error';
    error: string;
    [argument: string]: any;
    message: string;
};

export type Event = {
    type: 'event';
    event: string;
    [argument: string]: any;
};

// # Commands

// ## Attributes

export type AttributeUnsignedInt = {
    type: 'unsigned_int';
    value: string;
};

export type AttributeSignedInt = {
    type: 'signed_int';
    value: string;
};

export type AttributeString = {
    type: 'string';
    value: string;
};

export type AttributeDouble = {
    type: 'double';
    value: number;
};

export type Attribute =
| AttributeUnsignedInt
| AttributeSignedInt
| AttributeString
| AttributeDouble;

export type AttributeMap = {
    [name: string]: AttributeMap;
};

// ## Command: List Scopes

export type ScopeDescriptionModule = {
    type: 'module';
    definition: {
        src: null | string;
        name: null | string;
        attributes: AttributeMap;
    };
    instantiation: {
        src: null | string;
        attributes: AttributeMap;
    }
};

export type ScopeDescription =
| ScopeDescriptionModule;

export type CommandListScopes = {
    type: 'command';
    command: 'list_scopes';
};

export type ResponseListScopes = {
    type: 'response';
    command: 'list_scopes';
    scopes: {
        [identifier: string]: ScopeDescription;
    };
};

// ## Command: List Items

export type ItemDescriptionNode = {
    src: null | string;
    type: 'node';
    lsb_at: number;
    width: number;
    input: boolean;
    output: boolean;
    settable: boolean;
    attributes: AttributeMap;
};

export type ItemDescriptionMemory = {
    src: null | string;
    type: 'memory';
    lsb_at: number;
    width: number;
    zero_at: number;
    depth: number;
    settable: boolean;
    attributes: AttributeMap;
};

export type ItemDescription =
| ItemDescriptionNode
| ItemDescriptionMemory;

export type CommandListItems = {
    type: 'command';
    command: 'list_items';
    scope: null | string;
};

export type ResponseListItems = {
    type: 'response';
    command: 'list_items';
    items: {
        [identifier: string]: ItemDescription;
    };
};

// ## Command: Reference Items

export type ItemDesignation =
| [string]
| [string, number, number];

export type CommandReferenceItems = {
    type: 'command';
    command: 'reference_items';
    reference: string;
    items: null | ItemDesignation[];
};

export type ResponseReferenceItems = {
    type: 'response';
    response: 'reference_items';
};

// ## Command: Query Interval

export type TimePoint = string;

export type DiagnosticType =
| 'break'
| 'print'
| 'assert'
| 'assume';

export type Diagnostic = {
    type: DiagnosticType;
    text: string;
    src: null | string;
};

export type Sample = {
    time: TimePoint;
    item_values?: string;
    diagnostics?: Diagnostic[];
};

export type CommandQueryInterval = {
    type: 'command';
    command: 'query_interval';
    interval: [TimePoint, TimePoint];
    collapse: boolean;
    items: string;
    item_values_encoding: string;
    diagnostics: boolean;
};

export type ResponseQueryInterval = {
    type: 'response';
    command: 'query_interval';
    samples: Sample[];
};

// ## Command: Get Simulation Status

export type CommandGetSimulationStatus = {
    type: 'command';
    command: 'get_simulation_status';
};

export type ResponseGetSimulationStatus = {
    type: 'response';
    command: 'get_simulation_status';
    status: 'paused';
    latest_time: TimePoint;
    next_sample_time: TimePoint;
} | {
    type: 'response';
    command: 'get_simulation_status';
    status: 'running' | 'finished';
    latest_time: TimePoint;
};

// ## Command: Run Simulation

export type CommandRunSimulation = {
    type: 'command';
    command: 'run_simulation';
    until_time: null | TimePoint;
    until_diagnostics: DiagnosticType[];
    sample_item_values: boolean;
};

export type ResponseRunSimulation = {
    type: 'response';
    command: 'run_simulation';
};

// ## Command: Pause Simulation

export type CommandPauseSimulation = {
    type: 'command';
    command: 'pause_simulation';
};

export type ResponsePauseSimulation = {
    type: 'response';
    command: 'pause_simulation';
    time: TimePoint;
};

// # Events

// ## Event: Simulation Paused

export type PauseCause =
| 'until_time'
| 'until_diagnostics'
;

export type EventSimulationPaused = {
    type: 'event';
    event: 'simulation_paused';
    time: TimePoint;
    cause: PauseCause;
};

// ## Event: Simulation Finished

export type EventSimulationFinished = {
    type: 'event';
    event: 'simulation_finished';
    time: TimePoint;
};

// # Afterword

export type AnyCommand =
| CommandListScopes
| CommandListItems
| CommandReferenceItems
| CommandQueryInterval
| CommandGetSimulationStatus
| CommandRunSimulation
| CommandPauseSimulation
;

export type AnyResponse =
| ResponseListScopes
| ResponseListItems
| ResponseReferenceItems
| ResponseQueryInterval
| ResponseGetSimulationStatus
| ResponseRunSimulation
| ResponsePauseSimulation
;

export type AnyEvent =
| EventSimulationPaused
| EventSimulationFinished
;

export type ClientPacket =
| ClientGreeting
| AnyCommand;

export type ServerPacket =
| ServerGreeting
| AnyResponse
| AnyEvent
| Error;
