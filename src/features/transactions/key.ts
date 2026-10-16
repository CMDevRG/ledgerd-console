/** ledgerd's rule for an Idempotency-Key: 1 to 255 visible ASCII characters. */
export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{1,255}$/;

export const KEY_RULE =
  'Use 1 to 255 visible characters: letters, digits and punctuation, no spaces';

export function validateKey(key: string): string | undefined {
  return IDEMPOTENCY_KEY_PATTERN.test(key) ? undefined : KEY_RULE;
}

/**
 * A fresh key: a random version 4 UUID. `crypto.randomUUID` exists only in secure contexts
 * (https or localhost); `getRandomValues` exists everywhere, so the console also works when it
 * is served over plain http on another host.
 */
export function newIdempotencyKey(source: Pick<Crypto, 'getRandomValues'> = crypto): string {
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
