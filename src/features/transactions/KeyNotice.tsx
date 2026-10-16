import { ApiError } from '../../api/problem';
import { Button } from '../../ui/Button';

/**
 * What a failure means for the Idempotency-Key, which is the question a person has after a
 * failed write: can I send this again, and with which key?
 *
 * - `reused`: the key already belongs to a different request.
 * - `not_used`: ledgerd answered and recorded nothing, so the key is still free.
 * - `unknown`: no usable answer arrived, so the request may or may not have been recorded.
 */
export type KeyStatus = 'reused' | 'not_used' | 'unknown';

export function keyStatus(error: unknown): KeyStatus | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code === 'idempotency_key_reuse') return 'reused';
  // The console server could not pass the request on or get an answer: unknown, like a network failure.
  if (error.kind === 'network' || error.kind === 'unexpected') return 'unknown';
  // A refusal (4xx/422) or "busy" (503): ledgerd answered and changed nothing.
  return 'not_used';
}

const TEXT: Record<KeyStatus, { title: string; body: string }> = {
  reused: {
    title: 'This key is already used by a different request',
    body: 'A key identifies one request. ledgerd remembers the one it first saw with this key and refuses a different one. To send something different, use a new key.',
  },
  not_used: {
    title: 'The key was not used up',
    body: 'ledgerd refused this request and recorded nothing, so the same key may be used again. Fix the problem and send again; keep the key or take a new one, as you prefer.',
  },
  unknown: {
    title: 'It is not known whether ledgerd recorded this',
    body: 'No usable answer arrived. Send it again with the same key: if ledgerd did record it, you get the original result back (a replay) and nothing happens twice. Do not take a new key, or the money could move twice.',
  },
};

/** The advice for a failure, and for a reused key a way to take a new one. */
export function KeyNotice({ error, onNewKey }: { error: unknown; onNewKey?: () => void }) {
  const status = keyStatus(error);
  if (status === undefined) return null;
  const text = TEXT[status];
  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-500 p-3 text-sm">
      <p className="font-semibold">{text.title}</p>
      <p>{text.body}</p>
      {status === 'reused' && onNewKey !== undefined ? (
        <div>
          <Button onClick={onNewKey}>Use a new key</Button>
        </div>
      ) : null}
    </div>
  );
}
