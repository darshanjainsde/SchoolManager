/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  // `\s\d+\.spec\.ts` — iCloud drops "foo 2.spec.ts" conflict copies into the
  // tree; running them means running a stale duplicate of a test that has
  // since changed. Same ignore as @library/api and @library/db.
  testPathIgnorePatterns: ['/node_modules/', '\\s\\d+\\.spec\\.ts$'],
};
