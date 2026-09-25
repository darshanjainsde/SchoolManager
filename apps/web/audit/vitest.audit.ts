// Standalone (NOT merged with the app config — mergeConfig concatenates the
// include globs and drags the whole jsdom suite in). Only the aliases matter.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    // node by default (the sports renderer is pure renderToStaticMarkup); the
    // Pay renderer is hook-driven and opts into jsdom with a file pragma, so
    // the setup file has to be available to it.
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    globals: true,
    include: ['audit/**/*.test.tsx'],
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../', import.meta.url)),
      '@skoolos/types': fileURLToPath(new URL('../../../packages/types/src', import.meta.url)),
      '@skoolos/db': fileURLToPath(new URL('../../../packages/db/src', import.meta.url)),
    },
  },
});
