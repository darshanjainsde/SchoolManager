import { portalForRole } from '../roles';

it.each([
  ['STUDENT', '/(family)/home'],
  ['TEACHER', '/(staff)/today'],
  ['SCHOOL_ADMIN', '/(staff)/today'],
  ['STAFF', '/(staff)/today'],
] as const)('%s → %s', (role, path) => {
  expect(portalForRole(role)).toBe(path);
});

it('rejects OWNER (web-only)', () => {
  expect(() => portalForRole('OWNER')).toThrow(/web/i);
});
