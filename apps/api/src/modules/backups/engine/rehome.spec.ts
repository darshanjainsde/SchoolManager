import { Prisma } from '@skoolos/db';
import type { ColumnInfo } from './db';
import { PACK_EXCLUDED_MODELS, RehomeOptions, derivedUuid, rehomeRow, shiftDate, weeksBetween } from './rehome';
import { TablePlan, buildSchemaPlan } from './schema-plan';

const plan = buildSchemaPlan();
const table = (model: string): TablePlan => plan.byModel.get(model)!;

const TARGET = '11111111-1111-1111-1111-111111111111';
const opts = (over: Partial<RehomeOptions> = {}): RehomeOptions => ({
  targetSchoolId: TARGET,
  shiftWeeks: 0,
  codePrefix: { from: null, to: null },
  remapIds: false,
  ...over,
});

/** The target table's columns, as `tableColumns` reports them. */
const cols = (spec: Record<string, string>): ColumnInfo[] =>
  Object.entries(spec).map(([name, udt]) => ({ name, udt, nullable: true, hasDefault: false }));
const NONE: ColumnInfo[] = [];

describe('a pack is shifted by whole weeks, so a register keeps its weekdays', () => {
  it('counts whole weeks between two moments, towards zero', () => {
    expect(weeksBetween(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-29T00:00:00Z'))).toBe(4);
    expect(weeksBetween(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-11T00:00:00Z'))).toBe(1);
    expect(weeksBetween(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-02T00:00:00Z'))).toBe(0);
    expect(weeksBetween(new Date('2026-09-29T00:00:00Z'), new Date('2026-09-01T00:00:00Z'))).toBe(-4);
  });

  it('keeps a timestamp on the same weekday and at the same time of day', () => {
    const was = new Date('2026-09-14T09:35:00.000Z'); // a Monday
    const now = new Date(shiftDate(was.toISOString(), 3));
    expect(now.getUTCDay()).toBe(was.getUTCDay());
    expect(now.toISOString()).toBe('2026-10-05T09:35:00.000Z');
  });

  it('keeps a date-only value date-only, and on its weekday', () => {
    expect(shiftDate('2026-09-14', 2)).toBe('2026-09-28');
    expect(new Date('2026-09-28T00:00:00Z').getUTCDay()).toBe(new Date('2026-09-14T00:00:00Z').getUTCDay());
  });

  it('leaves a value alone when there is nothing to shift', () => {
    expect(shiftDate('2026-09-14T09:35:00.000Z', 0)).toBe('2026-09-14T09:35:00.000Z');
    expect(shiftDate('', 3)).toBe('');
    expect(shiftDate('not a date', 3)).toBe('not a date');
  });
});

describe('re-homing one row onto another school', () => {
  it('moves the row to the target school and leaves its primary key alone', () => {
    const row = { id: 'abc', schoolId: 'old-school', firstName: 'Asha' };
    const out = rehomeRow(row, table('Student'), NONE, opts());
    expect(out.schoolId).toBe('11111111-1111-1111-1111-111111111111');
    expect(out.id).toBe('abc');
    expect(row.schoolId).toBe('old-school'); // the input is untouched
  });

  it('shifts every date column the schema declares, and nothing else', () => {
    const t = table('Attendance');
    expect(t.dateColumns).toContain('date');
    const out = rehomeRow({ id: 'a', schoolId: 'x', date: '2026-09-14', status: 'PRESENT' }, t, NONE, opts({ shiftWeeks: 2 }));
    expect(out.date).toBe('2026-09-28');
    expect(out.status).toBe('PRESENT');
  });

  it('does not mistake a text column that merely looks like a date', () => {
    const t = table('Student');
    const out = rehomeRow({ id: 'a', schoolId: 'x', firstName: '2026-09-14' }, t, NONE, opts({ shiftWeeks: 2 }));
    expect(out.firstName).toBe('2026-09-14');
  });

  it('swaps the school code prefix and keeps the number', () => {
    const out = rehomeRow(
      { id: 'a', schoolId: 'x', code: 'RPS-00042', admissionNo: 'RPS-00042' },
      table('Student'), NONE, opts({ codePrefix: { from: 'RPS', to: 'SNS' } }),
    );
    expect(out.code).toBe('SNS-00042');
    expect(out.admissionNo).toBe('SNS-00042');
  });

  it('leaves a code that does not carry the source prefix exactly as it is', () => {
    const out = rehomeRow(
      { id: 'a', schoolId: 'x', code: 'LEGACY/7' },
      table('Student'), NONE, opts({ codePrefix: { from: 'RPS', to: 'SNS' } }),
    );
    expect(out.code).toBe('LEGACY/7');
  });

  it('leaves codes alone when the two schools share a prefix or one is unknown', () => {
    const same = rehomeRow({ id: 'a', schoolId: 'x', code: 'RPS-1' }, table('Student'), NONE, opts({ codePrefix: { from: 'RPS', to: 'RPS' } }));
    expect(same.code).toBe('RPS-1');
    const unknown = rehomeRow({ id: 'a', schoolId: 'x', code: 'RPS-1' }, table('Student'), NONE, opts({ codePrefix: { from: null, to: 'SNS' } }));
    expect(unknown.code).toBe('RPS-1');
  });

  it('keeps a null date null', () => {
    const out = rehomeRow({ id: 'a', schoolId: 'x', date: null }, table('Attendance'), NONE, opts({ shiftWeeks: 5 }));
    expect(out.date).toBeNull();
  });
});

describe('ids are mapped so a pack can land beside the school it came from', () => {
  const COLS = cols({
    id: 'uuid', schoolId: 'uuid', classSectionId: 'uuid', gradeIds: '_uuid', firstName: 'text', rollNo: 'int4',
  });
  const row = {
    id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    schoolId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
    classSectionId: 'cccccccc-3333-4333-8333-cccccccccccc',
    gradeIds: ['dddddddd-4444-4444-8444-dddddddddddd'],
    firstName: 'Asha',
    rollNo: 7,
  };

  it('derives the same new id every time, and a different one per school', () => {
    const a = derivedUuid(TARGET, row.id);
    expect(derivedUuid(TARGET, row.id)).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(derivedUuid('99999999-9999-4999-8999-999999999999', row.id)).not.toBe(a);
    expect(a).not.toBe(row.id);
  });

  it('maps the key and every pointer to it, so a child still finds its parent', () => {
    const out = rehomeRow(row, table('Student'), COLS, opts({ remapIds: true }));
    expect(out.id).toBe(derivedUuid(TARGET, row.id));
    expect(out.classSectionId).toBe(derivedUuid(TARGET, row.classSectionId));
    // A pointer maps to exactly what the parent's key will map to.
    const parent = rehomeRow({ id: row.classSectionId, schoolId: row.schoolId }, table('ClassSection'), COLS, opts({ remapIds: true }));
    expect(parent.id).toBe(out.classSectionId);
  });

  it('maps a uuid ARRAY too — a list of ids carries references like any other column', () => {
    const out = rehomeRow(row, table('Student'), COLS, opts({ remapIds: true }));
    expect(out.gradeIds).toEqual([derivedUuid(TARGET, row.gradeIds[0])]);
  });

  it('always points schoolId at the target, never at a derived value', () => {
    const out = rehomeRow(row, table('Student'), COLS, opts({ remapIds: true }));
    expect(out.schoolId).toBe(TARGET);
  });

  it('leaves text and numbers alone, including text that is not a uuid', () => {
    const out = rehomeRow(row, table('Student'), COLS, opts({ remapIds: true }));
    expect(out.firstName).toBe('Asha');
    expect(out.rollNo).toBe(7);
  });

  it('keeps the ids when a school\u2019s own archive goes back into it', () => {
    const out = rehomeRow(row, table('Student'), COLS, opts({ remapIds: false }));
    expect(out.id).toBe(row.id);
    expect(out.classSectionId).toBe(row.classSectionId);
  });
});

describe('what a sample pack must never carry', () => {
  it('names only real models, so a rename cannot put one back into packs', () => {
    const names = new Set(Prisma.dmmf.datamodel.models.map((m) => m.name));
    for (const n of Object.keys(PACK_EXCLUDED_MODELS)) expect([n, names.has(n)]).toEqual([n, true]);
  });

  it('gives a reason for each, because the next person will want to add one back', () => {
    for (const [, why] of Object.entries(PACK_EXCLUDED_MODELS)) expect(why.length).toBeGreaterThan(15);
  });

  it('excludes the two that would reach a real person outside the demo', () => {
    expect(Object.keys(PACK_EXCLUDED_MODELS)).toEqual(expect.arrayContaining(['PushToken', 'GuestSession']));
  });
});
