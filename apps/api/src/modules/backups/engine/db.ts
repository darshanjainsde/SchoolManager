/**
 * The engine's only view of the database: raw SQL. It is handed a client by
 * whoever runs it (the API's platform client, or the CLI's own), so the engine
 * itself never decides which role it connects as.
 *
 * Raw SQL rather than Prisma delegates, on purpose:
 *  - rows are read with row_to_json and written with json_populate_recordset,
 *    so Postgres itself converts every value to its exact column type —
 *    enums, uuids, arrays, jsonb, timestamps — with nothing lost in a
 *    JavaScript round trip (a jsonb `null` vs SQL NULL, @updatedAt being
 *    overwritten, a Float's last digit);
 *  - columns are matched against the TARGET database's real columns, so a
 *    backup from older code imports into newer code.
 */
export interface RawDb {
  query<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  execute(sql: string, ...params: unknown[]): Promise<number>;
  /** Runs the statements in ONE transaction, in order. */
  transaction(statements: { sql: string; params?: unknown[] }[]): Promise<void>;
}

type PrismaLike = {
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
  $transaction(ops: unknown[]): Promise<unknown>;
};

export function rawDbFromPrisma(p: PrismaLike): RawDb {
  return {
    query: <T>(sql: string, ...params: unknown[]) => p.$queryRawUnsafe<T[]>(sql, ...params),
    execute: (sql, ...params) => p.$executeRawUnsafe(sql, ...params),
    transaction: async (statements) => {
      await p.$transaction(statements.map((s) => p.$executeRawUnsafe(s.sql, ...(s.params ?? []))));
    },
  };
}

/** Postgres error code from a Prisma raw-query error, when there is one. */
export function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; meta?: { code?: string }; message?: string };
  if (err?.meta?.code) return err.meta.code;
  const m = /Code: `(\w{5})`|code: "(\w{5})"|SQLSTATE (\w{5})/.exec(err?.message ?? '');
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

/** Applied, not rolled back — the schema version a backup came from. */
export async function appliedMigrations(db: RawDb): Promise<string[]> {
  const rows = await db.query<{ name: string }>(
    `SELECT migration_name AS name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
  );
  return rows.map((r) => r.name);
}

export interface ColumnInfo {
  name: string;
  nullable: boolean;
  hasDefault: boolean;
  /** Postgres' own type name: `uuid`, `text`, `_uuid` for a uuid array, … */
  udt: string;
}

/** The target table's real columns. Empty when the table does not exist here. */
export async function tableColumns(db: RawDb, table: string): Promise<ColumnInfo[]> {
  const rows = await db.query<{ name: string; nullable: string; def: string | null; gen: string; ident: string; udt: string }>(
    `SELECT column_name AS name, is_nullable AS nullable, column_default AS def,
            is_generated AS gen, is_identity AS ident, udt_name AS udt
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1
      ORDER BY ordinal_position`,
    table,
  );
  return rows
    .filter((r) => r.gen !== 'ALWAYS')
    .map((r) => ({ name: r.name, nullable: r.nullable === 'YES', hasDefault: r.def != null || r.ident === 'YES', udt: r.udt }));
}
