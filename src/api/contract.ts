/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- the usual way to write an exact type-equality check */
import type { z } from 'zod';

import type { components } from './schema';
import type { problemSchema } from './problem';
import type {
  accountSchema,
  accountsPageSchema,
  balanceSchema,
  postingSchema,
  postingsPageSchema,
  reconciliationSchema,
  transactionSchema,
} from './schemas';

/*
 * Compile-time proof that the runtime schemas describe exactly what the contract (the
 * types generated from ledgerd's docs/openapi.yaml) describes. Nothing here runs. If the
 * API changes and `npm run generate:api` is run, any schema that no longer matches turns
 * into a type error on the line below.
 */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type Schemas = components['schemas'];

export type ContractChecks = [
  Expect<Equal<z.input<typeof accountSchema>, Schemas['Account']>>,
  Expect<Equal<z.input<typeof accountsPageSchema>, Schemas['AccountsPage']>>,
  Expect<Equal<z.input<typeof postingSchema>, Schemas['Posting']>>,
  Expect<Equal<z.input<typeof postingsPageSchema>, Schemas['PostingsPage']>>,
  Expect<Equal<z.input<typeof transactionSchema>, Schemas['Transaction']>>,
  Expect<Equal<z.input<typeof balanceSchema>, Schemas['BalanceResult']>>,
  Expect<Equal<z.input<typeof reconciliationSchema>, Schemas['ReconciliationReport']>>,
  // The console also receives problems from its own server (extra error codes), so the
  // schema is wider than ledgerd's: what ledgerd sends must be accepted by it.
  Expect<Schemas['Problem'] extends z.input<typeof problemSchema> ? true : false>,
];
