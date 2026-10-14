import { z } from 'zod';

import { toBigInt } from '../money';

/*
 * Runtime descriptions of every response the console reads. They exist because a
 * response is parsed, not trusted. They are checked against the generated contract types
 * at compile time in contract.ts, so they cannot drift from docs/openapi.yaml.
 *
 * Money arrives as digit strings and leaves as bigint.
 */

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
const currency = z.string().regex(/^[A-Z0-9]{2,10}$/);
const side = z.enum(['DEBIT', 'CREDIT']);
const accountType = z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']);

/** A balance or amount: a string of digits from the API, a bigint here. */
const money = z
  .string()
  .regex(/^-?\d{1,38}$/)
  .transform(toBigInt);

export const accountSchema = z.object({
  id: uuid,
  code: z.string(),
  currency,
  type: accountType,
  normal_balance: side,
  allow_negative: z.boolean(),
  balance: money,
  last_posting_at: timestamp.nullable(),
  created_at: timestamp,
});

export const accountsPageSchema = z.object({
  accounts: z.array(accountSchema),
  next_cursor: z.string().nullable(),
});

export const postingSchema = z.object({
  id: z.number().int(),
  transaction_id: uuid,
  account_id: uuid,
  direction: side,
  amount: z
    .string()
    .regex(/^[1-9]\d{0,30}$/)
    .transform(toBigInt),
  currency,
  balance_after: money,
  recorded_at: timestamp,
});

export const postingsPageSchema = z.object({
  postings: z.array(postingSchema),
  next_cursor: z.string().nullable(),
});

export const transactionSchema = z.object({
  id: uuid,
  description: z.string(),
  reverses_id: uuid.nullable(),
  created_at: timestamp,
  postings: z.array(postingSchema),
});

export const balanceSchema = z.object({
  account_id: uuid,
  currency,
  balance: money,
  last_posting_at: timestamp.nullable(),
  as_of: timestamp.nullable(),
});

export const reconciliationSchema = z.object({
  started_at: timestamp,
  deep: z.boolean(),
  ok: z.boolean(),
  accounts_checked: z.number().int().nonnegative(),
  mismatches: z.array(
    z.object({ account_id: uuid, code: z.string(), currency, stored: money, expected: money }),
  ),
  currencies: z.array(z.object({ currency, debits: money, credits: money, balanced: z.boolean() })),
  chain_breaks: z.array(
    z.object({ posting_id: z.number().int(), account_id: uuid, recorded: money, expected: money }),
  ),
});

export const readinessSchema = z.object({ status: z.literal('ready') });

/** The shapes the rest of the application works with (money already converted to bigint). */
export type Account = z.output<typeof accountSchema>;
export type AccountsPage = z.output<typeof accountsPageSchema>;
export type Posting = z.output<typeof postingSchema>;
export type PostingsPage = z.output<typeof postingsPageSchema>;
export type Transaction = z.output<typeof transactionSchema>;
export type Balance = z.output<typeof balanceSchema>;
export type ReconciliationReport = z.output<typeof reconciliationSchema>;
