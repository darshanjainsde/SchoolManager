/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  testRegex: 'test/.*\\.e2e\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '\\s\\d+\\.e2e\\.spec\\.ts$'],
  moduleNameMapper: { '^@library/db$': '<rootDir>/../../packages/library-db/src' },
  testTimeout: 30000,
};
