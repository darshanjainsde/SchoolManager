/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  testRegex: 'test/integration/.*\\.e2e-spec\\.ts$',
  globalSetup: '<rootDir>/test/integration/global-setup.ts',
  testTimeout: 60000,
  moduleNameMapper: {
    '^@skoolos/db$': '<rootDir>/../../packages/db/src',
    '^@skoolos/types$': '<rootDir>/../../packages/types/src',
    '^@skoolos/config$': '<rootDir>/../../packages/config/src',
  },
  // Worker spec imports cross-app code at the source level — allow this for
  // the test build only (production never crosses app boundaries).
  globals: { 'ts-jest': { isolatedModules: true } },
  // Run tests serially so they don't race on the shared database.
  maxWorkers: 1,
};
