import { ApiError } from '../../api/problem';
import type {
  Check,
  Exchange,
  LabApi,
  LabRequest,
  ScenarioId,
  ScenarioResult,
  Step,
  Verdict,
} from './types';

export const check = (label: string, expected: string, actual: string, ok?: boolean): Check => ({
  label,
  expected,
  actual,
  ok: ok ?? expected === actual,
});

/** What a step can do: send requests (recorded in the step) and say what it checked. */
export interface StepContext {
  send(request: LabRequest): Promise<Exchange>;
  /** Adds an observation to the step. */
  note(text: string): void;
  /** Runs `work` and tells the most requests that were on the network at once, if known. */
  observe<T>(work: () => Promise<T>): Promise<{ value: T; peak: number | undefined }>;
}

/**
 * Collects the steps of a scenario. `step` runs one: every request it sends is recorded in it,
 * and the checks it returns are kept. If a request gets no answer at all, the scenario stops and
 * its verdict is `could-not-run`: a lab that cannot reach the ledger proves nothing.
 */
export class Run {
  readonly steps: Step[] = [];
  private failure: string | undefined;

  constructor(private readonly api: LabApi) {}

  get stopped(): boolean {
    return this.failure !== undefined;
  }

  async step(
    title: string,
    explanation: string,
    body: (ctx: StepContext) => Promise<Check[]>,
  ): Promise<void> {
    if (this.failure !== undefined) return;
    const exchanges: Exchange[] = [];
    const notes: string[] = [];
    const ctx: StepContext = {
      send: async (request) => {
        const exchange = await this.api.send(request);
        exchanges.push(exchange);
        return exchange;
      },
      note: (text) => {
        notes.push(text);
      },
      observe: async (work) =>
        this.api.observeConcurrency
          ? this.api.observeConcurrency(work)
          : { value: await work(), peak: undefined },
    };
    let checks: Check[] = [];
    try {
      checks = await body(ctx);
    } catch (error) {
      this.failure =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : 'The request could not be sent.';
    }
    this.steps.push({ title, explanation, exchanges, checks, notes });
  }

  finish(id: ScenarioId): ScenarioResult {
    return {
      id,
      verdict: verdictOf(this.steps, this.failure),
      steps: this.steps,
      ...(this.failure !== undefined ? { error: this.failure } : {}),
    };
  }
}

/**
 * `as-designed` only if something was checked and every check passed. A scenario that checked
 * nothing proves nothing, so it is not `as-designed`.
 */
export function verdictOf(steps: readonly Step[], failure?: string): Verdict {
  if (failure !== undefined) return 'could-not-run';
  const checks = steps.flatMap((s) => s.checks);
  return checks.length > 0 && checks.every((c) => c.ok) ? 'as-designed' : 'unexpected';
}
