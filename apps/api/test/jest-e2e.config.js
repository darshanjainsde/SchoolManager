/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  // testRegex matches *.e2e-spec.ts under test/ (integration/ subdir OR test root) so root-level suites like tenant-isolation are discovered.
  testRegex: 'test/(integration/)?.*\\.e2e-spec\\.ts$',
  globalSetup: '<rootDir>/test/integration/global-setup.ts',
  // setup-env.ts runs in each worker after globalSetup.  When DATABASE_URL_TEST
  // is provided (e.g. for owner e2e hitting the running dev-API), it overrides
  // the skoolos_test URLs that globalSetup wrote into the main process env.
  // Without DATABASE_URL_TEST the file defaults back to skoolos_test — keeping
  // the tenant-isolation suite unchanged.
  setupFiles: ['<rootDir>/test/integration/setup-env.ts'],
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
