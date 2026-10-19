import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * zod probes whether it may compile validators with `new Function`. Under the Content Security
 * Policy that probe is refused and reported as a violation, so the console turns it off. These
 * tests watch for the probe, in a fresh copy of zod each time.
 */
async function constructionsOfFunction(imports: () => Promise<unknown>): Promise<number> {
  vi.resetModules();
  const calls: unknown[][] = [];
  vi.stubGlobal(
    'Function',
    new Proxy(Function, {
      construct(_target, args: unknown[]) {
        calls.push(args);
        throw new EvalError('refused by the Content Security Policy');
      },
    }),
  );
  await imports();
  const { z } = await import('zod');
  z.object({ a: z.string(), b: z.number() }).parse({ a: 'x', b: 1 });
  return calls.length;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('zod under a policy without unsafe-eval', () => {
  it('(control) probes for new Function when nothing is configured, so the watch can see it', async () => {
    expect(await constructionsOfFunction(() => Promise.resolve())).toBeGreaterThan(0);
  });

  it('does not once the console has configured it', async () => {
    expect(await constructionsOfFunction(() => import('./zod'))).toBe(0);
  });

  it('still validates correctly without the compiled fast path', async () => {
    vi.resetModules();
    await import('./zod');
    const { z } = await import('zod');
    const schema = z.object({
      id: z.string().regex(/^\d+$/),
      amount: z.string().transform((s) => BigInt(s)),
    });
    expect(schema.parse({ id: '12', amount: '9007199254740993' })).toEqual({
      id: '12',
      amount: 9007199254740993n,
    });
    expect(schema.safeParse({ id: 'x', amount: '1' }).success).toBe(false);
  });
});
