/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  // Runs before the module registry loads, so modules that call loadEnv() at
  // import time find a valid (fake) environment — see test/env.setup.js.
  setupFiles: ['<rootDir>/../test/env.setup.js'],
  testRegex: '.*\\.spec\\.ts$',
  // Every suite here is mocked — none of them waits on IO, so a timeout can
  // only ever fire because 149 suites are sharing the machine. Jest's 5 s
  // default was failing three innocent suites on a full run while each passed
  // on its own; 20 s is still far short of a real hang.
  testTimeout: 20_000,
  moduleNameMapper: {
    '^@skoolos/db$': '<rootDir>/../../../packages/db/src',
    '^@skoolos/types$': '<rootDir>/../../../packages/types/src',
    '^@skoolos/config$': '<rootDir>/../../../packages/config/src',
  },
};
