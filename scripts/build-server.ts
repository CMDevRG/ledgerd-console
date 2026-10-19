import { build } from 'esbuild';
import { join } from 'node:path';

/**
 * Bundles the console server and everything it imports into one file, so the runtime image
 * needs Node and this file and nothing from node_modules.
 *
 * Nothing from the environment is baked in: esbuild's `define` is not used, and the API key is
 * read from the environment when the server starts. `check:build` proves that by building
 * with a canary key set and looking for it in the output.
 */
export async function buildServer(outdir: string): Promise<string> {
  const outfile = join(outdir, 'main.mjs');
  await build({
    entryPoints: ['server/src/main.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: true,
    legalComments: 'none',
    logLevel: 'warning',
    // Packages written for CommonJS may call require() or use __dirname inside the ES module.
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  });
  return outfile;
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  const outdir = process.argv[2] ?? 'dist-server';
  buildServer(outdir).then(
    (file) => {
      process.stdout.write(`${file}\n`);
    },
    (error: unknown) => {
      process.stderr.write(
        `build-server: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    },
  );
}
