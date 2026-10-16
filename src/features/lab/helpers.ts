import { check } from './steps';
import type { Check, Exchange } from './types';
import type { StepContext } from './steps';

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
