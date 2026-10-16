import { check, type Run, type StepContext } from './steps';
import type { Check, Exchange } from './types';

/**
 * The problem code of an exchange, if it was an error with a problem document. (A successful
 * answer can have a `code` field of its own: an account does.)
 */
export function problemCode(exchange: Exchange): string | undefined {
  if (exchange.status < 400) return undefined;
  const body = exchange.responseBody;
  if (
    typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    typeof body.code === 'string'
  ) {
    return body.code;
  }
  return undefined;
}

/** `201`, or `422 insufficient_funds`: how an answer reads in a check. */
export function describeAnswer(exchange: Exchange): string {
  const code = problemCode(exchange);
  return code === undefined ? String(exchange.status) : `${String(exchange.status)} ${code}`;
}

export const expectAnswer = (label: string, expected: string, exchange: Exchange): Check =>
  check(label, expected, describeAnswer(exchange));

export interface LabAccount {
  id: string;
  code: string;
}

/** The id inside an answer that should be an account or a transaction. */
export function idOf(exchange: Exchange): string | undefined {
  const body = exchange.responseBody;
  return typeof body === 'object' && body !== null && 'id' in body && typeof body.id === 'string'
    ? body.id
    : undefined;
}

/** Creates a lab account (`lab-<run>-<name>`), recording the request in the current step. */
export async function createLabAccount(
  ctx: StepContext,
  runId: string,
  name: string,
  options: {
    type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
    normalBalance: 'DEBIT' | 'CREDIT';
    allowNegative: boolean;
    currency?: string;
  },
): Promise<{ exchange: Exchange; account: LabAccount | undefined }> {
  const code = `lab-${runId}-${name}`;
  const exchange = await ctx.send({
    method: 'POST',
    path: '/v1/accounts',
    body: {
      code,
      currency: options.currency ?? 'USD',
      type: options.type,
      normal_balance: options.normalBalance,
      allow_negative: options.allowNegative,
    },
  });
  const id = idOf(exchange);
  return { exchange, account: id === undefined ? undefined : { id, code } };
}

/** The balance of an account as a digit string, recording the request. */
export async function readBalance(
  ctx: StepContext,
  accountId: string,
): Promise<{ exchange: Exchange; balance: string | undefined }> {
  const exchange = await ctx.send({ method: 'GET', path: `/v1/accounts/${accountId}` });
  const body = exchange.responseBody;
  const balance =
    typeof body === 'object' &&
    body !== null &&
    'balance' in body &&
    typeof body.balance === 'string'
      ? body.balance
      : undefined;
  return { exchange, balance };
}

/** A transaction request moving `amount` minor units: debit one account, credit another. */
export function transfer(
  debit: string,
  credit: string,
  amount: string,
  options: { currency?: string; description?: string } = {},
): { description?: string; postings: unknown[] } {
  const currency = options.currency ?? 'USD';
  return {
    ...(options.description !== undefined ? { description: options.description } : {}),
    postings: [
      { account_id: debit, direction: 'DEBIT', amount, currency },
      { account_id: credit, direction: 'CREDIT', amount, currency },
    ],
  };
}

/** The kinds of lab account: a bank may go negative (it pays out); a wallet may not. */
export type LabAccountKind = 'bank' | 'wallet';

const KIND = {
  bank: { type: 'ASSET', normalBalance: 'DEBIT', allowNegative: true },
  wallet: { type: 'LIABILITY', normalBalance: 'CREDIT', allowNegative: false },
} as const;

/**
 * A step that creates lab accounts `lab-<run>-<name>`. It returns the ids by name (an empty
 * string where creation failed, which the following checks will then show).
 */
export async function createAccountsStep(
  run: Run,
  runId: string,
  accounts: readonly { name: string; kind: LabAccountKind }[],
  explanation?: string,
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  await run.step(
    accounts.length === 1 ? 'Create a lab account' : 'Create lab accounts',
    explanation ??
      "A bank account (an asset that may go negative, so it can pay out) and a wallet (a liability whose balance may not go below zero). Their codes start with lab- and this run's id, so they never touch your other accounts.",
    async (ctx) => {
      const checks: Check[] = [];
      for (const { name, kind } of accounts) {
        const made = await createLabAccount(ctx, runId, name, KIND[kind]);
        ids[name] = made.account?.id ?? '';
        checks.push(expectAnswer(`${name} created`, '201', made.exchange));
      }
      return checks;
    },
  );
  return ids;
}

/** Reverses a transaction, recording the request. */
export function reverse(ctx: StepContext, transactionId: string, key: string): Promise<Exchange> {
  return ctx.send({
    method: 'POST',
    path: `/v1/transactions/${transactionId}/reverse`,
    idempotencyKey: key,
  });
}

/** Sends a transaction, recording the request. */
export function postTransaction(ctx: StepContext, key: string, body: unknown): Promise<Exchange> {
  return ctx.send({ method: 'POST', path: '/v1/transactions', idempotencyKey: key, body });
}

/** A response header as the exchange recorded it, or "absent". */
export const headerOf = (exchange: Exchange, name: string): string =>
  exchange.responseHeaders[name] ?? 'absent';

/** The fields named by the errors of a validation problem, as one string. */
export function errorFields(exchange: Exchange): string {
  const body = exchange.responseBody;
  if (
    typeof body !== 'object' ||
    body === null ||
    !('errors' in body) ||
    !Array.isArray(body.errors)
  ) {
    return 'none';
  }
  const fields = body.errors.flatMap((e: unknown) =>
    typeof e === 'object' && e !== null && 'field' in e && typeof e.field === 'string'
      ? [e.field]
      : [],
  );
  return fields.length === 0 ? 'none' : fields.join(', ');
}

/** The balance as text, for a check ("unreadable" if it could not be read). */
export async function balanceText(ctx: StepContext, accountId: string): Promise<string> {
  return (await readBalance(ctx, accountId)).balance ?? 'unreadable';
}

/**
 * A check that an error names a field. The error may name others too (a refused amount is
 * reported on every posting that has one), so the field only has to be among those named.
 */
export function namesField(exchange: Exchange, field: string): Check {
  const named = errorFields(exchange);
  return check('The error names the field', field, named, named.split(', ').includes(field));
}
