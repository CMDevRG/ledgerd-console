import { inspect } from 'node:util';

const REDACTED = '[REDACTED]';

/**
 * Holds a value that must never be printed. Every way of turning it into text (string
 * conversion, template literals, JSON, console output, util.inspect, error messages that
 * include it) yields "[REDACTED]". The real value is only available through `reveal()`,
 * so a leak needs an explicit, searchable call.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  get length(): number {
    return this.#value.length;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }

  [Symbol.toPrimitive](): string {
    return REDACTED;
  }
}
