/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  // Runs before the module registry loads, so modules that call loadEnv() at
  // import time find a valid (fake) environment — see test/env.setup.js.
  setupFiles: ['<rootDir>/../test/env.setup.js'],
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@skoolos/db$': '<rootDir>/../../../packages/db/src',
    '^@skoolos/types$': '<rootDir>/../../../packages/types/src',
    '^@skoolos/config$': '<rootDir>/../../../packages/config/src',
  },
};
