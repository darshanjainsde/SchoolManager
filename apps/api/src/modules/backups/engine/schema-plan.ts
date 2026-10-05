import { Prisma } from '@skoolos/db';

/**
 * WHAT A SCHOOL IS, READ FROM THE SCHEMA — never from a hand-kept list.
 *
 * Every model with a `schoolId` column is school data. A table added next
 * month is in every backup, every import and every delete without anyone
 * remembering this file exists; the alternative ("add your table to the
 * backup list") is the defect this repo has already paid for twice.
 *
 * The plan gives three things the engine needs:
 *  - the INSERT order (parents before children), from the foreign keys;
 *  - the DELETE order (the reverse), plus every RESTRICT link INTO a school's
 *    rows from anywhere — those block a delete and must be cleared first;
 *  - each table's primary key, so export can page through it.
 */

type DmmfModel = (typeof Prisma.dmmf.datamodel.models)[number];
type DmmfField = DmmfModel['fields'][number];

/**
 * Left OUT of a backup, on purpose. Each is a short-lived credential: carrying
 * it to another machine would carry a live way in, and dropping it only means
 * people sign in again. A name here that stops existing in the schema fails a
 * test, so a rename cannot quietly put a credential back into backups.
 */
export const EXCLUDED_MODELS: Readonly<Record<string, string>> = {
  RefreshToken: 'a signed-in session — people sign in again after a restore',
  OtpChallenge: 'a one-time login code that expires in minutes',
  ImpersonationToken: 'an owner "log in as" link that expires in minutes',
};

export type OnDelete = 'Cascade' | 'Restrict' | 'NoAction' | 'SetNull' | 'SetDefault';

export interface ForeignKey {
  /** Column(s) on this table. */
  columns: string[];
  refModel: string;
  refTable: string;
  refColumns: string[];
  nullable: boolean;
  onDelete: OnDelete;
}

export interface TablePlan {
  model: string;
  /** The real table name in Postgres (honours @@map). */
  table: string;
  /** Primary-key column names, in order. */
  pk: string[];
  /** Foreign keys to OTHER school tables (links to School itself are not listed). */
  fks: ForeignKey[];
  /** Foreign keys from a table to itself (MenuItem.parentId). Rows must be ordered within the table. */
  selfFks: ForeignKey[];
  /** True when `schoolId` may be null (platform rows share the table: User, AuditLog, …). */
  schoolIdNullable: boolean;
  /** Field name → column name, for every scalar column. */
  columns: Record<string, string>;
  /** Columns holding a date or timestamp — what a sample pack shifts in time. */
  dateColumns: string[];
}

export interface InboundRestrict {
  /** The table holding the blocking rows (may be another school's rows). */
  childTable: string;
  childColumns: string[];
  /** The school table they point at. */
  parentTable: string;
  parentColumns: string[];
}

export interface SchemaPlan {
  /** School tables, parents first. */
  insertOrder: TablePlan[];
  /** School tables, children first. */
  deleteOrder: TablePlan[];
  /** RESTRICT / NO ACTION links into school tables, keyed by parent table. */
  inboundRestricts: Map<string, InboundRestrict[]>;
  byModel: Map<string, TablePlan>;
  excluded: string[];
  /** Real table names of the excluded models — still deleted with the school. */
  excludedTables: string[];
}

const colOf = (m: DmmfModel, fieldName: string): string => {
  const f = m.fields.find((x) => x.name === fieldName);
  if (!f) throw new Error(`schema-plan: ${m.name}.${fieldName} does not exist`);
  return (f as DmmfField & { dbName?: string | null }).dbName ?? f.name;
};
const tableOf = (m: DmmfModel): string => m.dbName ?? m.name;

function effectiveOnDelete(f: DmmfField): OnDelete {
  const explicit = (f as DmmfField & { relationOnDelete?: OnDelete }).relationOnDelete;
  if (explicit) return explicit;
  // Prisma's defaults when none is written: required → Restrict, optional → SetNull.
  return f.isRequired ? 'Restrict' : 'SetNull';
}

export function buildSchemaPlan(models: readonly DmmfModel[] = Prisma.dmmf.datamodel.models): SchemaPlan {
  const byName = new Map(models.map((m) => [m.name, m]));
  const isSchool = (m: DmmfModel) => m.fields.some((f) => f.name === 'schoolId' && f.kind === 'scalar');
  const included = models.filter((m) => isSchool(m) && !(m.name in EXCLUDED_MODELS));
  const includedNames = new Set(included.map((m) => m.name));

  const plans = new Map<string, TablePlan>();
  for (const m of included) {
    const idField = m.fields.find((f) => f.isId);
    const pk = idField ? [colOf(m, idField.name)] : (m.primaryKey?.fields ?? []).map((f) => colOf(m, f));
    if (pk.length === 0) throw new Error(`schema-plan: ${m.name} has no primary key`);
    const columns: Record<string, string> = {};
    for (const f of m.fields) if (f.kind === 'scalar' || f.kind === 'enum') columns[f.name] = colOf(m, f.name);
    const fks: ForeignKey[] = [];
    const selfFks: ForeignKey[] = [];
    for (const f of m.fields) {
      if (f.kind !== 'object' || !f.relationFromFields?.length) continue;
      const ref = byName.get(f.type);
      if (!ref || ref.name === 'School') continue;
      const fk: ForeignKey = {
        columns: f.relationFromFields.map((n) => colOf(m, n)),
        refModel: ref.name,
        refTable: tableOf(ref),
        refColumns: (f.relationToFields ?? []).map((n) => colOf(ref, n)),
        nullable: f.relationFromFields.every((n) => !m.fields.find((x) => x.name === n)!.isRequired),
        onDelete: effectiveOnDelete(f),
      };
      if (ref.name === m.name) selfFks.push(fk);
      else if (includedNames.has(ref.name)) fks.push(fk);
      // A link to an excluded or platform model is not ordered here; import
      // treats any value it cannot find as a dangling reference.
      else fks.push(fk);
    }
    plans.set(m.name, {
      model: m.name, table: tableOf(m), pk, fks, selfFks,
      schoolIdNullable: !m.fields.find((f) => f.name === 'schoolId')!.isRequired,
      columns,
      dateColumns: m.fields.filter((f) => f.kind === 'scalar' && f.type === 'DateTime').map((f) => colOf(m, f.name)),
    });
  }

  // Topological order over links between INCLUDED tables (Kahn, stable by schema order).
  const deps = new Map<string, Set<string>>();
  for (const p of plans.values()) {
    deps.set(p.model, new Set(p.fks.filter((fk) => plans.has(fk.refModel)).map((fk) => fk.refModel)));
  }
  const order: TablePlan[] = [];
  const done = new Set<string>();
  const names = [...plans.keys()];
  while (order.length < names.length) {
    const ready = names.filter((n) => !done.has(n) && [...deps.get(n)!].every((d) => done.has(d)));
    if (ready.length === 0) {
      const stuck = names.filter((n) => !done.has(n));
      throw new Error(`schema-plan: foreign keys form a cycle among ${stuck.join(', ')} — a backup cannot order them`);
    }
    for (const n of ready) { done.add(n); order.push(plans.get(n)!); }
  }

  // Every RESTRICT / NO ACTION link pointing INTO a school table, from any model —
  // including platform models and other schools' rows of school models.
  const inboundRestricts = new Map<string, InboundRestrict[]>();
  for (const m of models) {
    for (const f of m.fields) {
      if (f.kind !== 'object' || !f.relationFromFields?.length) continue;
      const target = plans.get(f.type);
      if (!target) continue;
      const od = effectiveOnDelete(f);
      if (od !== 'Restrict' && od !== 'NoAction') continue;
      const ref = byName.get(f.type)!;
      const list = inboundRestricts.get(target.table) ?? [];
      list.push({
        childTable: tableOf(m),
        childColumns: f.relationFromFields.map((n) => colOf(m, n)),
        parentTable: target.table,
        parentColumns: (f.relationToFields ?? []).map((n) => colOf(ref, n)),
      });
      inboundRestricts.set(target.table, list);
    }
  }

  return {
    insertOrder: order,
    deleteOrder: [...order].reverse(),
    inboundRestricts,
    byModel: plans,
    excluded: Object.keys(EXCLUDED_MODELS),
    excludedTables: models.filter((m) => m.name in EXCLUDED_MODELS && isSchool(m)).map(tableOf),
  };
}

/** Postgres identifier quoting. Names come from the schema, never from a user. */
export const q = (ident: string): string => `"${ident.replace(/"/g, '""')}"`;

/** Orders a self-referencing table's rows so every parent is inserted before its children. */
export function orderSelfReferencing(
  rows: Record<string, unknown>[],
  pk: string,
  selfFks: ForeignKey[],
): Record<string, unknown>[] {
  if (selfFks.length === 0) return rows;
  const ids = new Set(rows.map((r) => String(r[pk])));
  const placed = new Set<string>();
  const out: Record<string, unknown>[] = [];
  let pending = rows;
  while (pending.length) {
    const next: Record<string, unknown>[] = [];
    for (const r of pending) {
      const waitsOn = selfFks
        .map((fk) => r[fk.columns[0]])
        .filter((v) => v != null && ids.has(String(v)) && !placed.has(String(v)) && String(v) !== String(r[pk]));
      if (waitsOn.length === 0) { out.push(r); placed.add(String(r[pk])); } else next.push(r);
    }
    if (next.length === pending.length) {
      throw new Error(`rows form a parent cycle (${next.length} rows) — cannot be ordered`);
    }
    pending = next;
  }
  return out;
}
