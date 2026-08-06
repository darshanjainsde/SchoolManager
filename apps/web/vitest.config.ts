import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true,
    // Component tests import from app/ and lib/; exclude build output and e2e.
    include: ['{app,lib,components}/**/*.test.{ts,tsx}'],
    // Vitest's 5s default measures WALL CLOCK, not this test's own work, so it
    // is really a limit on how busy the machine is allowed to be. Suites run in
    // parallel: one genuinely slow test has twice now pushed unrelated,
    // already-passing tests past 5s and failed them — a red run that says
    // nothing about the code. A higher ceiling costs time only on a real
    // failure, never on the happy path.
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      // Mirrors the `@/*` path in apps/web/tsconfig.json. Read that file and
      // match it exactly — a drifting alias makes tests import a different
      // module than the app does.
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // Mirrors the `@skoolos/types` path in apps/web/tsconfig.json, added
      // alongside it because apps/web has no tsconfig path for workspace
      // packages otherwise — it resolves them purely through the pnpm
      // symlink in node_modules/@skoolos/*. Vite's resolver follows that
      // symlink fine on its own, but this alias keeps the two configs in
      // lockstep in case that ever changes.
      '@skoolos/types': fileURLToPath(new URL('../../packages/types/src', import.meta.url)),
    },
  },
});
