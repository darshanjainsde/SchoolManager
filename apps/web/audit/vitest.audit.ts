// Standalone (NOT merged with the app config — mergeConfig concatenates the
// include globs and drags the whole jsdom suite in). Only the aliases matter.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'node', globals: true, include: ['audit/**/*.test.tsx'] },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../', import.meta.url)),
      '@skoolos/types': fileURLToPath(new URL('../../../packages/types/src', import.meta.url)),
      '@skoolos/db': fileURLToPath(new URL('../../../packages/db/src', import.meta.url)),
    },
  },
});
