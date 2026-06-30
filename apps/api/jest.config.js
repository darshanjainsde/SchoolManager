/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@skoolos/db$': '<rootDir>/../../../packages/db/src',
    '^@skoolos/types$': '<rootDir>/../../../packages/types/src',
    '^@skoolos/config$': '<rootDir>/../../../packages/config/src',
  },
};
