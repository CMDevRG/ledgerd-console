import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Where the console server listens during development (see server/).
const consoleServer = process.env.CONSOLE_SERVER_URL ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // The browser only ever talks to this origin. The dev server forwards /api to the
    // console server (which holds the API key), so there is no cross-origin request
    // and no CORS to configure.
    proxy: {
      '/api': consoleServer,
    },
  },
  build: {
    target: 'es2023',
    sourcemap: true,
  },
  test: {
    css: false,
    // Two projects: the browser application (jsdom) and the console server (Node).
    projects: [
      {
        extends: true,
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['./src/test/setup.ts'],
          // axe-core is thorough and slow in jsdom, and the whole suite runs in parallel on one
          // machine. A test that fails because it was starved of CPU says nothing about the code,
          // so the limit is generous; a test that really hangs still fails.
          testTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'server/src/**/*.ts'],
      exclude: ['src/api/schema.d.ts', 'src/test/**', 'src/main.tsx', '**/*.test.{ts,tsx}'],
      reporter: ['text-summary', 'json-summary', 'html'],
      // The floor below which `npm run coverage` fails (R16.6). Measured when it was set:
      // statements 96.7 %, branches 93.5 %, functions 95.5 %, lines 96.9 %. The floor sits a
      // little under that, so a change that leaves a feature untested fails, and ordinary
      // refactoring does not. Raise it when the numbers rise; never lower it to get a green run.
      thresholds: { statements: 95, branches: 90, functions: 93, lines: 95 },
    },
  },
});
