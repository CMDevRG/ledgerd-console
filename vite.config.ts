import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Where the ledgerd API listens during development.
const ledgerd = process.env.LEDGERD_URL ?? 'http://127.0.0.1:8085';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // The browser only ever talks to this origin. The dev server forwards the API
    // paths, so there is no cross-origin request (and no CORS) to configure.
    proxy: {
      '/healthz': ledgerd,
      '/readyz': ledgerd,
    },
  },
  build: {
    target: 'es2023',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/api/schema.d.ts', 'src/test/**', 'src/main.tsx', 'src/**/*.test.{ts,tsx}'],
    },
  },
});
