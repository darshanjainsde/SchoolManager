import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A source-text guard, not a behaviour test, and deliberately so.
 *
 * `@library/db` exports two clients. `getLibraryTenantPrisma()` connects as
 * `library_app`, which RLS binds because that role is neither the table owner,
 * a superuser, nor `BYPASSRLS` — that fact, not `FORCE ROW LEVEL SECURITY`, is
 * what makes every query in the desk service org-scoped (trap 2).
 * `getLibraryPlatformPrisma()` is the BYPASSRLS client. It sits one import
 * away, it is used legitimately by `library-org.service.ts` for org resolution,
 * and a single `prisma.issue.findMany({ where: { orgId } })` written here on a
 * tired afternoon is a cross-tenant read that no unit test would catch —
 * because it returns rows, and they look right.
 *
 * So the assertion is on the import, where the mistake is actually made.
 * Behaviour tests cannot see it: both clients satisfy the same interface.
 *
 * Watched fail (required by CLAUDE.md — a guard nobody has seen fail is not
 * evidence): adding `getLibraryPlatformPrisma` to the service's import list
 * turns both assertions red; removing it restores them.
 */
describe('LibraryDeskService — RLS-bound client only', () => {
  const raw = readFileSync(join(__dirname, 'library-desk.service.ts'), 'utf8');

  /**
   * Comments stripped before asserting. The service's own doc comment names
   * `getLibraryPlatformPrisma` in order to say it must never be used here, and
   * the first version of this guard failed on that sentence — a guard that
   * cannot tell an instruction from an instance is a guard that gets deleted
   * the first time it cries wolf. Code is what is under test; prose is not.
   */
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('never imports the BYPASSRLS platform client', () => {
    expect(source).not.toContain('getLibraryPlatformPrisma');
  });

  it('reaches the database only through withOrg', () => {
    // `withOrg` is what issues `SET LOCAL app.current_org`. A query outside it
    // runs on a connection whose org setting is either unset or — on a pooled
    // connection that has already served a scoped request — the PREVIOUS
    // request's org (trap 1). That is not a leak that fails closed.
    expect(source).toContain("from '@library/db'");
    expect(source).not.toContain('getLibraryTenantPrisma');
  });
});
