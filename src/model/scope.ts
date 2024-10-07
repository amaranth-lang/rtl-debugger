import * as proto from '../cxxrtl/proto';
import { Location } from './source';
import { Variable } from './variable';

export abstract class Scope {
    constructor(
        readonly fullName: string[],
        readonly location: Location | null,
        readonly scopes: Scope[] | Thenable<Scope[]>,
        readonly variables: Variable[] | Thenable<Variable[]>,
    ) {}

    static fromCXXRTL(
        cxxrtlName: string,
        cxxrtlDesc: proto.ScopeDescription,
        nestedScopes: Scope[] | Thenable<Scope[]>,
        nestedVariables: Variable[] | Thenable<Variable[]>,
    ) {
        const fullName = cxxrtlName === '' ? [] : cxxrtlName.split(' ');
        if (cxxrtlDesc.type === 'module') {
            const moduleName = cxxrtlDesc.definition.name?.split(' ') || [];
            return new ModuleScope(
                fullName,
                Location.fromCXXRTL(cxxrtlDesc.instantiation.src),
                moduleName,
                Location.fromCXXRTL(cxxrtlDesc.definition.src),
                nestedScopes,
                nestedVariables,
            );
        } else {
            throw new Error(`Unknown scope type in ${cxxrtlDesc}`);
        }
    }

    get name(): string {
        if (this.fullName.length === 0) {
            return '';
        } else {
            return this.fullName[this.fullName.length - 1];
        }
    }

    get parentFullName(): string[] | null {
        if (this.fullName.length === 0) {
            return null;
        } else {
            return this.fullName.slice(0, -1);
        }
    }

    get cxxrtlIdentifier(): string {
        return this.fullName.join(' ');
    }
}

export class ModuleScope extends Scope {
    constructor(
        fullName: string[],
        location: Location | null,
        readonly moduleFullName: string[],
        readonly moduleLocation: Location | null,
        scopes: Scope[] | Thenable<Scope[]>,
        variables: Variable[] | Thenable<Variable[]>,
    ) {
        super(fullName, location, scopes, variables);
    }

    get moduleName(): string {
        if (this.moduleFullName.length === 0) {
            return '';
        } else {
            return this.moduleFullName[this.moduleFullName.length - 1];
        }
    }
}
