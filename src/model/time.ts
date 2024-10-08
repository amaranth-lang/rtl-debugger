export class TimePoint {
    static RESOLUTION: bigint = 1_000_000_000_000_000n; // femto

    static ZERO: TimePoint = new TimePoint(0n, 0n);

    // Femtoseconds since beginning of time.
    readonly #raw: bigint = 0n;

    constructor(secs: bigint, femtos: bigint) {
        this.#raw = secs * TimePoint.RESOLUTION + femtos;
    }

    public get secs(): bigint {
        return this.#raw / TimePoint.RESOLUTION;
    }

    public get femtos(): bigint {
        return this.#raw % TimePoint.RESOLUTION;
    }

    public equals(other: TimePoint): boolean {
        return this.#raw === other.#raw;
    }

    public greaterThan(other: TimePoint): boolean {
        return this.#raw > other.#raw;
    }

    public lessThan(other: TimePoint): boolean {
        return this.#raw < other.#raw;
    }

    public offsetByFemtos(femtos: bigint): TimePoint {
        return new TimePoint(this.secs, this.femtos + femtos);
    }

    public differenceInFemtos(other: TimePoint): bigint {
        return this.#raw - other.#raw;
    }

    public toString(): string {
        function groupDecimals(num: bigint) {
            const groups: string[] = [];
            if (num === 0n) {
                groups.push('0');
            } else {
                while (num !== 0n) {
                    groups.push(`${num % 1000n}`);
                    num /= 1000n;
                }
            }
            return groups
                .map((group, index) => index === groups.length - 1 ? group : group.padStart(3, '0'))
                .reverse()
                .join(',');
        }

        if (this.#raw % 1_000_000_000_000_000n === 0n) {
            return `${groupDecimals(this.#raw / 1_000_000_000_000_000n)}s`;
        } else if (this.#raw % 1_000_000_000_000n === 0n) {
            return `${groupDecimals(this.#raw / 1_000_000_000_000n)}ms`;
        } else if (this.#raw % 1_000_000_000n === 0n) {
            return `${groupDecimals(this.#raw / 1_000_000_000n)}us`;
        } else if (this.#raw % 1_000_000n === 0n) {
            return `${groupDecimals(this.#raw / 1_000_000n)}ns`;
        } else if (this.#raw % 1_000n === 0n) {
            return `${groupDecimals(this.#raw / 1_000n)}ps`;
        } else {
            return `${groupDecimals(this.#raw)}fs`;
        }
    }

    public static fromString(value: string): TimePoint {
        const matches = value.match(/^(\d+)\s*(s|ms|us|ns|ps|fs)$/);
        if (matches === null) {
            throw new SyntaxError(`${JSON.stringify(value)} is not a valid time point`);
        }
        const mantissa = BigInt(matches[1].replaceAll(',', ''));
        switch (matches[2]) {
            case 's':
                return new TimePoint(mantissa, 0n);
            case 'ms':
                return new TimePoint(0n, mantissa * 1_000_000_000_000n);
            case 'us':
                return new TimePoint(0n, mantissa * 1_000_000_000n);
            case 'ns':
                return new TimePoint(0n, mantissa * 1_000_000n);
            case 'ps':
                return new TimePoint(0n, mantissa * 1_000n);
            case 'fs':
                return new TimePoint(0n, mantissa);
            default:
                throw new Error('unreachable');
        }
    }

    public static fromCXXRTL(value: string): TimePoint {
        const matches = value.match(/^(\d+)\.(\d+)$/);
        if (matches === null) {
            throw new SyntaxError(`${JSON.stringify(value)} is not a valid time point`);
        }
        return new TimePoint(BigInt(matches[1]), BigInt(matches[2]));
    }

    public toCXXRTL(): string {
        return `${this.secs.toString()}.${this.femtos.toString().padStart(15, '0')}`;
    }
}

export class TimeInterval {
    constructor(public begin: TimePoint, public end: TimePoint) {}

    public static fromCXXRTL([begin, end]: [string, string]): TimeInterval {
        return new TimeInterval(TimePoint.fromCXXRTL(begin), TimePoint.fromCXXRTL(end));
    }

    public toCXXRTL(): [string, string] {
        return [this.begin.toCXXRTL(), this.end.toCXXRTL()];
    }
}
