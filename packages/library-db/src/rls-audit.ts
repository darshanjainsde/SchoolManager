import type { PrismaClient } from '../generated/client';

/**
 * Tables that legitimately carry no RLS policy. Each is keyed by a hash of a
 * single-use secret, so possession of the token IS the authorisation and there
 * is no tenant column to scope by. Adding a fourth entry requires editing this
 * list, which is visible in review — that is the point.
 */
export const RLS_ALLOW_LIST = ['RefreshToken', 'PasswordResetToken', 'RegistrationToken'];

export interface RlsAuditResult {
  /**
   * True only when at least one tenant table was inspected AND none of them
   * are unprotected. `unprotected: []` alone is not sufficient — a query
   * against an empty or mis-scoped schema also returns zero offenders, which
   * must not be reported as healthy. See `tablesChecked`.
   */
  ok: boolean;
  /** Tables with an orgId column that are missing FORCE RLS or a policy. */
  unprotected: string[];
  allowListed: string[];
  /**
   * Count of orgId- (or, for LibraryOrg, id-) bearing tables the audit
   * actually found and evaluated in the `library` schema. Zero here means
   * the audit saw no tenant tables at all — e.g. the database is empty, the
   * migration silently failed, or `?schema=` pointed somewhere else — and is
   * itself a failure, independent of what `unprotected` says.
   */
  tablesChecked: number;
}

export async function auditRlsCoverage(client: PrismaClient): Promise<RlsAuditResult> {
  const rows = await client.$queryRawUnsafe<{ relname: string; protected: boolean }[]>(`
    SELECT
      c.relname,
      (
        c.relrowsecurity
        AND c.relforcerowsecurity
        AND EXISTS (
          -- A policy existing is not enough: CREATE POLICY p ON "Loan"
          -- USING (true) is forced, policied, and leaks every tenant. The
          -- USING expression must actually reference app.current_org, and a
          -- WITH CHECK clause must be present (NULL polwithcheck means
          -- writes are unconstrained even if reads are scoped).
          -- pg_get_expr(polqual, polrelid) renders the policy's USING
          -- clause back to SQL text so it can be pattern-matched.
          SELECT 1 FROM pg_policy p
          WHERE p.polrelid = c.oid
            AND p.polwithcheck IS NOT NULL
            AND pg_get_expr(p.polqual, p.polrelid) LIKE '%app.current_org%'
        )
      ) AS protected
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'library'
      AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'library'
          AND col.table_name = c.relname
          AND col.column_name IN ('orgId', 'id')
          AND (col.column_name = 'orgId' OR c.relname = 'LibraryOrg')
      )
    ORDER BY c.relname
  `);

  const tablesChecked = rows.length;
  const unprotected = rows
    .filter((r) => !r.protected)
    .map((r) => r.relname)
    .filter((name) => !RLS_ALLOW_LIST.includes(name));

  return {
    ok: tablesChecked > 0 && unprotected.length === 0,
    unprotected,
    allowListed: RLS_ALLOW_LIST,
    tablesChecked,
  };
}
