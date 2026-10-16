import { describe, expect, it } from 'vitest';

import { describeAnswer, idOf, problemCode, transfer } from './helpers';
import type { Exchange } from './types';

const ex = (status: number, responseBody: unknown): Exchange => ({
  method: 'POST',
  path: '/x',
  requestHeaders: {},
  status,
  responseHeaders: {},
  responseBody,
  ms: 1,
});

describe('problemCode and describeAnswer', () => {
  it('read the code of an error', () => {
    expect(problemCode(ex(422, { code: 'insufficient_funds' }))).toBe('insufficient_funds');
    expect(describeAnswer(ex(422, { code: 'insufficient_funds' }))).toBe('422 insufficient_funds');
    expect(describeAnswer(ex(409, { code: 'already_reversed' }))).toBe('409 already_reversed');
  });

  it('do not mistake the `code` of an account for a problem code', () => {
    expect(problemCode(ex(201, { id: 'a', code: 'lab-r1-wallet' }))).toBeUndefined();
    expect(describeAnswer(ex(201, { code: 'lab-r1-wallet' }))).toBe('201');
  });

  it('give just the status when an error has no usable body', () => {
    for (const body of [undefined, 'plain text', null, 5, { nocode: 1 }, { code: 7 }]) {
      expect(describeAnswer(ex(500, body)), JSON.stringify(body)).toBe('500');
    }
  });
});

describe('idOf', () => {
  it('reads an id from an object, and only a string one', () => {
    expect(idOf(ex(201, { id: 'abc' }))).toBe('abc');
    for (const body of [undefined, null, 'x', { id: 5 }, {}])
      expect(idOf(ex(201, body))).toBeUndefined();
  });
});

describe('transfer', () => {
  it('debits one account and credits another by the same amount', () => {
    expect(transfer('a', 'b', '100', { description: 'd' })).toEqual({
      description: 'd',
      postings: [
        { account_id: 'a', direction: 'DEBIT', amount: '100', currency: 'USD' },
        { account_id: 'b', direction: 'CREDIT', amount: '100', currency: 'USD' },
      ],
    });
  });
  it('leaves out the description when there is none, and takes another currency', () => {
    const t = transfer('a', 'b', '1', { currency: 'EUR' });
    expect('description' in t).toBe(false);
    expect(JSON.stringify(t)).toContain('"currency":"EUR"');
  });
});
