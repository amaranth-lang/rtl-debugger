import * as vscode from 'vscode';

import { UnboundReference, Designation, Reference } from './model/sample';
import { CXXRTLDebugger } from './debugger';
import { TimeInterval } from './model/time';

class Observable<T> {
    private callbacks: ((value: T) => void)[] = [];
    private value: T | undefined;

    constructor(
        readonly designation: Designation<T>
    ) {}

    register(callback: (value: T) => void): { dispose(): void } {
        this.callbacks.push(callback);
        return { dispose: () => this.callbacks.splice(this.callbacks.indexOf(callback), 1) };
    }

    query(): T | undefined {
        return this.value;
    }

    update(newValue: T) {
        if (this.value !== newValue) {
            this.value = newValue;
            this.callbacks = this.callbacks.filter((callback) => {
                const retain = callback(newValue);
                return retain === undefined || retain;
            });
        }
    }
}

export class Observer {
    private observables: Map<string, Observable<any>> = new Map();
    private reference: Reference | undefined;

    private samplePromise: Promise<void> | undefined;
    private refreshNeeded: boolean = false;

    private subscription: vscode.Disposable;

    constructor(
        private rtlDebugger: CXXRTLDebugger,
        private referenceName: string,
    ) {
        this.subscription = rtlDebugger.onDidChangeCurrentTime((_time) =>
            this.invalidate());
    }

    dispose() {
        this.subscription.dispose();
    }

    query<T>(designation: Designation<T>): T | undefined {
        const observable = this.observables.get(designation.canonicalKey);
        return observable?.query();
    }

    observe<T>(designation: Designation<T>, callback: (value: T) => any): { dispose(): void } {
        let observable = this.observables.get(designation.canonicalKey);
        if (observable === undefined) {
            observable = new Observable(designation);
            this.observables.set(designation.canonicalKey, observable);
            this.reference = undefined; // invalidate reference
            this.invalidate();
        }
        return observable.register(callback);
    }

    invalidate(): void {
        this.refreshNeeded = true;
        if (this.samplePromise === undefined) {
            this.samplePromise = this.refresh();
        }
    }

    private async refresh(): Promise<void> {
        while (this.refreshNeeded) {
            this.refreshNeeded = false;
            if (this.reference === undefined) {
                const unboundReference = new UnboundReference();
                for (const observable of this.observables.values()) {
                    unboundReference.add(observable.designation);
                }
                this.reference = this.rtlDebugger.bindReference(this.referenceName, unboundReference);
            }
            const interval = new TimeInterval(this.rtlDebugger.currentTime, this.rtlDebugger.currentTime);
            const reference = this.reference; // could get invalidated in the meantime
            const [sample] = await this.rtlDebugger.queryInterval(interval, reference);
            for (const [designation, handle] of reference.allHandles()) {
                const observable = this.observables.get(designation.canonicalKey)!;
                observable.update(sample.extract(handle));
            }
            // ... but we could've got another invalidate() call while awaiting, so check again.
        }
        this.samplePromise = undefined;
    }
}
