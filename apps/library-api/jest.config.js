/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  setupFiles: ['<rootDir>/../test/env.setup.js'],
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '\\s\\d+\\.spec\\.ts$'],
  moduleNameMapper: {
    '^@library/db$': '<rootDir>/../../../packages/library-db/src',
  },
};
