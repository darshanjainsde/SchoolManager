import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**'],
  },
  resolve: { alias: { '@': new URL('.', import.meta.url).pathname } },
  // `include` has always accepted `.tsx`, but no JSX test had ever been
  // written, so nothing revealed that JSX was never actually transformed:
  // tsconfig sets `"jsx": "preserve"` for Next's own compiler, esbuild honours
  // that and emits the JSX untouched, and the first rendering test failed with
  // a bare `ReferenceError: React is not defined`. `automatic` uses the modern
  // runtime, so no `import React` is needed in any test file. Nothing else is
  // required — @testing-library/react and jsdom were already devDependencies.
  esbuild: { jsx: 'automatic' },
});
