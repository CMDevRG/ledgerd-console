import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { Secret } from './secret';

const VALUE = 'super-secret-api-key-0123456789';

describe('Secret', () => {
  const secret = new Secret(VALUE);

  it('reveals its value only on request', () => {
    expect(secret.reveal()).toBe(VALUE);
    expect(secret.length).toBe(VALUE.length);
  });

  it.each<[string, () => string]>([
    ['String()', () => String(secret)],
    ['a template literal', () => `key=${secret as unknown as string}`],
    ['join', () => [secret].join(',')],
    ['JSON.stringify', () => JSON.stringify({ key: secret })],
    ['util.inspect', () => inspect(secret)],
    [
      'util.inspect of an object holding it',
      () => inspect({ nested: { key: secret } }, { depth: 5 }),
    ],
    ['an error message', () => new Error(`bad ${String(secret)}`).message],
  ])('is redacted by %s', (_name, render) => {
    const text = render();
    expect(text).not.toContain(VALUE);
    expect(text).toContain('[REDACTED]');
  });

  it('does not expose the value as an enumerable property', () => {
    expect(Object.keys(secret)).toEqual([]);
    expect(JSON.stringify(Object.getOwnPropertyNames(secret))).not.toContain(VALUE);
    expect(Object.values(secret)).toEqual([]);
  });
});
