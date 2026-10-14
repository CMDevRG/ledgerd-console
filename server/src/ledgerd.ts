import type { Config } from './config';

/**
 * Builds the readiness check of the console server: it is ready when ledgerd answers its
 * own /readyz with 200 within two seconds. The check never throws.
 */
export function ledgerdReadinessCheck(config: Config, timeoutMs = 2000): () => Promise<boolean> {
  const url = new URL('/readyz', config.ledgerdUrl);
  return async () => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  };
}
