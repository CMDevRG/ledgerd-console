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
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'server/src/**/*.ts'],
      exclude: ['src/api/schema.d.ts', 'src/test/**', 'src/main.tsx', '**/*.test.{ts,tsx}'],
    },
  },
});
