import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { makePosting } from '../../test/factories';
import type { Posting } from '../../api/schemas';
import { intermediatePostingIds } from './postings';

const p = (id: number, transaction: string): Posting => ({
  ...makePosting({ id, transaction_id: `00000000-0000-4000-8000-00000000000${transaction}` }),
  amount: 1n,
  balance_after: 1n,
});

describe('intermediatePostingIds', () => {
  it('marks nothing when every transaction touches the account once', () => {
    expect(intermediatePostingIds([p(3, '3'), p(2, '2'), p(1, '1')]).size).toBe(0);
    expect(intermediatePostingIds([]).size).toBe(0);
  });

  it('marks all but the last posting of a transaction that touches the account several times', () => {
    // newest first: ids 5 and 4 are the same transaction; 5 is the last one applied.
    expect([...intermediatePostingIds([p(5, '2'), p(4, '2'), p(3, '1')])]).toEqual([4]);
    expect([...intermediatePostingIds([p(6, '2'), p(5, '2'), p(4, '2')])].sort()).toEqual([4, 5]);
  });

  it('keeps transactions apart', () => {
    expect(
      [...intermediatePostingIds([p(6, '2'), p(5, '1'), p(4, '2'), p(3, '1')])].sort(),
    ).toEqual([3, 4]);
  });

  it('does not depend on the order of the list (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.tuple(fc.integer({ min: 1, max: 1000 }), fc.constantFrom('1', '2', '3')),
          {
            selector: ([id]) => id,
            maxLength: 30,
          },
        ),
        (rows) => {
          const postings = rows.map(([id, tx]) => p(id, tx));
          const forwards = intermediatePostingIds(postings);
          const backwards = intermediatePostingIds([...postings].reverse());
          expect([...forwards].sort()).toEqual([...backwards].sort());

          // Independent check: a posting is intermediate iff the same transaction has a higher id here.
          for (const posting of postings) {
            const later = postings.some(
              (q) => q.transaction_id === posting.transaction_id && q.id > posting.id,
            );
            expect(forwards.has(posting.id)).toBe(later);
          }
          // Exactly one posting per transaction is never marked.
          const transactions = new Set(postings.map((q) => q.transaction_id));
          expect(postings.length - forwards.size).toBe(transactions.size);
        },
      ),
    );
  });
});
