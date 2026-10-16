import { describe, expect, it } from 'vitest';

import { IDEMPOTENCY_KEY_PATTERN, KEY_RULE, newIdempotencyKey, validateKey } from './key';

describe('newIdempotencyKey', () => {
  it('is a version 4 UUID', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(newIdempotencyKey()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it('is different every time', () => {
    expect(new Set(Array.from({ length: 200 }, () => newIdempotencyKey())).size).toBe(200);
  });

  it('does not need crypto.randomUUID, which a page served over plain http does not have', () => {
    const onlyGetRandomValues = { getRandomValues: crypto.getRandomValues.bind(crypto) };
    expect(newIdempotencyKey(onlyGetRandomValues)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets the version and variant bits whatever the random bytes are', () => {
    for (const fill of [0x00, 0xff, 0x55, 0xaa]) {
      const key = newIdempotencyKey({
        getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
          (array as unknown as Uint8Array).fill(fill);
          return array;
        },
      });
      expect(key[14]).toBe('4');
      expect('89ab').toContain(key[19]);
    }
  });

  it('is a key ledgerd accepts', () => {
    expect(validateKey(newIdempotencyKey())).toBeUndefined();
  });
});

describe('validateKey (ledgerd: 1 to 255 visible ASCII characters)', () => {
  it.each(['a', '!', '~', 'abc-123_XYZ', 'x'.repeat(255), '3f2b8a52-2f8e-4c61-9a4e-0d6f4f0e7c11'])(
    'accepts %j',
    (key) => {
      expect(validateKey(key)).toBeUndefined();
    },
  );

  it.each(['', ' ', 'with space', 'tab\t', 'new\nline', 'x'.repeat(256), 'é', 'key\u007f', '日本'])(
    'refuses %j',
    (key) => {
      expect(validateKey(key)).toBe(KEY_RULE);
    },
  );

  it('uses the pattern from the contract', () => {
    expect(IDEMPOTENCY_KEY_PATTERN.source).toBe('^[\\x21-\\x7E]{1,255}$');
  });
});
