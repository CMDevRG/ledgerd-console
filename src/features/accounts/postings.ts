import type { Posting } from '../../api/schemas';

/**
 * The postings whose balance-after is not a committed state of the account.
 *
 * A transaction may touch the same account in several postings. They are applied one after
 * the other inside one database transaction, so the running balance after the first of them
 * was never visible to anyone: only the balance after the last one was committed. In a list
 * that is newest first, the last posting of a transaction on this account is the one with the
 * highest id; every other posting of that transaction here is intermediate.
 */
export function intermediatePostingIds(postings: readonly Posting[]): Set<number> {
  const highest = new Map<string, number>();
  for (const posting of postings) {
    const seen = highest.get(posting.transaction_id);
    if (seen === undefined || posting.id > seen) highest.set(posting.transaction_id, posting.id);
  }
  return new Set(postings.filter((p) => highest.get(p.transaction_id) !== p.id).map((p) => p.id));
}
