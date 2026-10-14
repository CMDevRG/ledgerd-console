import { loadConfig, isLoopback } from './config';
import { ledgerdReadinessCheck } from './ledgerd';
import { createLogger } from './logger';
import { startServer } from './server';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<number> {
  const loaded = loadConfig(process.env);
  if (!loaded.ok) {
    process.stderr.write(
      `ledgerd-console: invalid configuration\n${loaded.errors.map((e) => `  - ${e}`).join('\n')}\n`,
    );
    return 2;
  }
  const { config } = loaded;
  const logger = createLogger(config.logLevel, (line) => process.stdout.write(`${line}\n`));

  if (!isLoopback(config.host)) {
    logger.warn(
      'listening on a non-loopback address: anyone who can reach this port can use the ledger through the console',
      { host: config.host },
    );
  }

  const running = await startServer({
    config,
    logger,
    checkLedgerd: ledgerdReadinessCheck(config),
  });
  logger.info('console server listening', {
    address: `${running.address.address}:${String(running.address.port)}`,
    ledgerd: config.ledgerdUrl.origin,
    api_key: config.apiKey, // a Secret: logged as [REDACTED]
  });

  const stopped = new Promise<number>((resolve) => {
    const stop = (signal: string): void => {
      logger.info('shutting down: no new requests are accepted, finishing the ones in progress', {
        signal,
      });
      void running.close(SHUTDOWN_TIMEOUT_MS).then(({ forced }) => {
        logger.info('shutdown complete', { forced });
        resolve(forced ? 1 : 0);
      });
    };
    process.once('SIGTERM', () => {
      stop('SIGTERM');
    });
    process.once('SIGINT', () => {
      stop('SIGINT');
    });
  });
  return stopped;
}

main().then(
  (code) => {
    process.exit(code);
  },
  (error: unknown) => {
    process.stderr.write(
      `ledgerd-console: ${error instanceof Error ? error.message : 'failed to start'}\n`,
    );
    process.exit(1);
  },
);
