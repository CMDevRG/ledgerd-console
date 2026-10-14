import type { Problem } from '../api/problem';
import type { components } from '../api/schema';

/*
 * Test data typed by the types generated from ledgerd's OpenAPI file. If the API renames or
 * retypes a field, these factories stop compiling, so mocks cannot silently drift from the
 * contract.
 */
type S = components['schemas'];

export const ID_A = '3f2b8a52-2f8e-4c61-9a4e-0d6f4f0e7c11';
export const ID_B = '9a1d1c7e-5b52-4e5e-8f1c-2a7c8d9e0f11';
export const ID_TX = 'b5f1c9ea-82fb-4f28-a3eb-1c0106ee1251';
export const TIME = '2026-10-13T15:04:05.123456Z';

export function makeAccount(overrides: Partial<S['Account']> = {}): S['Account'] {
  return {
    id: ID_A,
    code: 'user-wallet',
    currency: 'USD',
    type: 'LIABILITY',
    normal_balance: 'CREDIT',
    allow_negative: false,
    balance: '10000',
    last_posting_at: TIME,
    created_at: TIME,
    ...overrides,
  };
}

export function makeAccountsPage(
  accounts: S['Account'][] = [makeAccount()],
  nextCursor: string | null = null,
): S['AccountsPage'] {
  return { accounts, next_cursor: nextCursor };
}

export function makePosting(overrides: Partial<S['Posting']> = {}): S['Posting'] {
  return {
    id: 1,
    transaction_id: ID_TX,
    account_id: ID_A,
    direction: 'CREDIT',
    amount: '10000',
    currency: 'USD',
    balance_after: '10000',
    recorded_at: TIME,
    ...overrides,
  };
}

export function makePostingsPage(
  postings: S['Posting'][] = [makePosting()],
  nextCursor: string | null = null,
): S['PostingsPage'] {
  return { postings, next_cursor: nextCursor };
}

export function makeTransaction(overrides: Partial<S['Transaction']> = {}): S['Transaction'] {
  return {
    id: ID_TX,
    description: 'Deposit 100.00',
    reverses_id: null,
    created_at: TIME,
    postings: [
      makePosting({ id: 1, account_id: ID_B, direction: 'DEBIT' }),
      makePosting({ id: 2, account_id: ID_A, direction: 'CREDIT' }),
    ],
    ...overrides,
  };
}

export function makeBalance(overrides: Partial<S['BalanceResult']> = {}): S['BalanceResult'] {
  return {
    account_id: ID_A,
    currency: 'USD',
    balance: '10000',
    last_posting_at: TIME,
    as_of: null,
    ...overrides,
  };
}

export function makeReport(
  overrides: Partial<S['ReconciliationReport']> = {},
): S['ReconciliationReport'] {
  return {
    started_at: TIME,
    deep: false,
    ok: true,
    accounts_checked: 2,
    mismatches: [],
    currencies: [{ currency: 'USD', debits: '10000', credits: '10000', balanced: true }],
    chain_breaks: [],
    ...overrides,
  };
}

export function makeProblem(overrides: Partial<S['Problem']> = {}): S['Problem'] {
  return {
    type: 'urn:ledgerd:error:validation_error',
    title: 'Validation failed',
    status: 422,
    code: 'validation_error',
    ...overrides,
  };
}

/** A problem sent by the console server itself, whose codes are not in ledgerd's contract. */
export function makeConsoleProblem(code: string, status: number): Problem {
  return {
    type: `urn:ledgerd-console:error:${code}`,
    title: code.replaceAll('_', ' '),
    status,
    code,
  };
}
