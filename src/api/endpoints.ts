import { request, RECONCILIATION_TIMEOUT_MS, type ApiResult } from './client';
import type { components } from './schema';
import {
  accountSchema,
  accountsPageSchema,
  balanceSchema,
  postingsPageSchema,
  readinessSchema,
  reconciliationSchema,
  transactionSchema,
  type Account,
  type AccountsPage,
  type Balance,
  type PostingsPage,
  type ReconciliationReport,
  type Transaction,
} from './schemas';

/* One function per API call the console makes. Each is a thin, typed wrapper over `request`. */

export type CreateAccountBody = components['schemas']['CreateAccountRequest'];
export type CreateTransactionBody = components['schemas']['CreateTransactionRequest'];

const IDEMPOTENCY_KEY = 'Idempotency-Key';

export function getReadiness(signal?: AbortSignal) {
  return request({ path: '/readyz', schema: readinessSchema, signal });
}

export interface ListAccountsParams {
  limit?: number;
  cursor?: string;
  codePrefix?: string;
  currency?: string;
}

export function listAccounts(
  params: ListAccountsParams = {},
  signal?: AbortSignal,
): Promise<ApiResult<AccountsPage>> {
  return request({
    path: '/v1/accounts',
    query: {
      limit: params.limit,
      cursor: params.cursor,
      code_prefix: params.codePrefix,
      currency: params.currency,
    },
    schema: accountsPageSchema,
    signal,
  });
}

export function createAccount(body: CreateAccountBody): Promise<ApiResult<Account>> {
  return request({ method: 'POST', path: '/v1/accounts', body, schema: accountSchema });
}

export function getAccount(id: string, signal?: AbortSignal): Promise<ApiResult<Account>> {
  return request({ path: `/v1/accounts/${id}`, schema: accountSchema, signal });
}

/** The balance now, or, when `asOf` (an RFC 3339 timestamp) is given, at that instant. */
export function getBalance(
  id: string,
  asOf?: string,
  signal?: AbortSignal,
): Promise<ApiResult<Balance>> {
  return request({
    path: `/v1/accounts/${id}/balance`,
    query: { as_of: asOf },
    schema: balanceSchema,
    signal,
  });
}

export function listPostings(
  id: string,
  params: { limit?: number; cursor?: string } = {},
  signal?: AbortSignal,
): Promise<ApiResult<PostingsPage>> {
  return request({
    path: `/v1/accounts/${id}/postings`,
    query: { limit: params.limit, cursor: params.cursor },
    schema: postingsPageSchema,
    signal,
  });
}

export function createTransaction(
  body: CreateTransactionBody,
  idempotencyKey: string,
): Promise<ApiResult<Transaction>> {
  return request({
    method: 'POST',
    path: '/v1/transactions',
    body,
    headers: { [IDEMPOTENCY_KEY]: idempotencyKey },
    schema: transactionSchema,
  });
}

export function getTransaction(id: string, signal?: AbortSignal): Promise<ApiResult<Transaction>> {
  return request({ path: `/v1/transactions/${id}`, schema: transactionSchema, signal });
}

export function reverseTransaction(
  id: string,
  idempotencyKey: string,
): Promise<ApiResult<Transaction>> {
  return request({
    method: 'POST',
    path: `/v1/transactions/${id}/reverse`,
    headers: { [IDEMPOTENCY_KEY]: idempotencyKey },
    schema: transactionSchema,
  });
}

export function reconcile(
  deep: boolean,
  signal?: AbortSignal,
): Promise<ApiResult<ReconciliationReport>> {
  return request({
    method: 'POST',
    path: '/v1/reconciliations',
    query: { deep },
    schema: reconciliationSchema,
    timeoutMs: RECONCILIATION_TIMEOUT_MS,
    signal,
  });
}
