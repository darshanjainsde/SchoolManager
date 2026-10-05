import { Prisma } from '@skoolos/db';
import { EXCLUDED_MODELS, buildSchemaPlan, orderSelfReferencing } from './schema-plan';

const models = Prisma.dmmf.datamodel.models;
const plan = buildSchemaPlan();
const pos = new Map(plan.insertOrder.map((p, i) => [p.model, i]));

describe('the backup plan is read from the real schema', () => {
  it('covers every model that carries a schoolId — except the named credentials — exactly once', () => {
    const want = models.filter((m) => m.fields.some((f) => f.name === 'schoolId')).map((m) => m.name)
      .filter((n) => !(n in EXCLUDED_MODELS)).sort();
    expect(plan.insertOrder.map((p) => p.model).sort()).toEqual(want);
    expect(new Set(plan.insertOrder.map((p) => p.model)).size).toBe(plan.insertOrder.length);
    expect(want.length).toBeGreaterThan(140);
  });

  it('every excluded name is still a real model — a rename must not quietly put a credential back into backups', () => {
    const names = new Set(models.map((m) => m.name));
    for (const n of Object.keys(EXCLUDED_MODELS)) expect(names.has(n)).toBe(true);
  });

  it('inserts every parent before every child it links to', () => {
    for (const p of plan.insertOrder) {
      for (const fk of p.fks) {
        if (!pos.has(fk.refModel)) continue;
        expect([p.model, fk.refModel, pos.get(fk.refModel)! < pos.get(p.model)!]).toEqual([p.model, fk.refModel, true]);
      }
    }
  });

  it('deletes in exactly the reverse order', () => {
    expect(plan.deleteOrder.map((p) => p.model)).toEqual([...plan.insertOrder].reverse().map((p) => p.model));
  });

  it('knows the chains that matter: a mark after its exam and child, an invoice line after its invoice', () => {
    const before = (a: string, b: string) => expect(pos.get(a)! < pos.get(b)!).toBe(true);
    before('Exam', 'Result');
    before('Student', 'Result');
    before('FeeInvoice', 'FeeInvoiceLine');
    before('FeeTerm', 'FeeInvoice');
    before('Event', 'EventTicketType');
    before('EventTicketType', 'EventRegistration');
  });

  it('pages tables without an `id` by their composite key', () => {
    expect(plan.byModel.get('FeeCounter')!.pk).toEqual(['schoolId', 'series']);
    expect(plan.byModel.get('EventAudienceSchool')!.pk).toEqual(['eventId', 'schoolId']);
    expect(plan.byModel.get('Student')!.pk).toEqual(['id']);
  });

  it('finds the RESTRICT links that used to make a school with fees undeletable', () => {
    const into = (t: string) => (plan.inboundRestricts.get(t) ?? []).map((r) => `${r.childTable}.${r.childColumns.join(',')}`).sort();
    expect(into('FeeTerm')).toContain('FeeInvoice.termId');
    expect(into('FeePlan')).toContain('FeeInvoice.planId');
    expect(into('FeeCategory')).toEqual(expect.arrayContaining(['FeeInvoiceLine.categoryId', 'FeePlanItem.categoryId']));
    expect(into('EventTicketType')).toContain('EventRegistration.ticketTypeId');
  });

  it('marks the tables whose schoolId may be empty, so platform rows are never swept into a school', () => {
    expect(plan.byModel.get('User')!.schoolIdNullable).toBe(true);
    expect(plan.byModel.get('Student')!.schoolIdNullable).toBe(false);
  });

  it('knows MenuItem points at itself', () => {
    expect(plan.byModel.get('MenuItem')!.selfFks.map((f) => f.columns[0])).toEqual(['parentId']);
  });
});

describe('the planner refuses a schema it cannot order', () => {
  const field = (name: string, extra: Record<string, unknown> = {}) => ({
    name, kind: 'scalar', type: 'String', isRequired: true, isId: false, isList: false, ...extra,
  });
  const rel = (name: string, type: string, from: string) => ({
    name, kind: 'object', type, isRequired: true, isList: false, relationFromFields: [from], relationToFields: ['id'],
  });
  const model = (name: string, fields: unknown[]) => ({ name, dbName: null, fields, primaryKey: null } as never);

  it('names the tables in a foreign-key cycle instead of looping', () => {
    const m = [
      model('School', [field('id', { isId: true })]),
      model('A', [field('id', { isId: true }), field('schoolId'), field('bId'), rel('b', 'B', 'bId')]),
      model('B', [field('id', { isId: true }), field('schoolId'), field('aId'), rel('a', 'A', 'aId')]),
    ];
    expect(() => buildSchemaPlan(m)).toThrow(/cycle among A, B/);
  });

  it('reads an unwritten onDelete the way Prisma does: required → Restrict', () => {
    const m = [
      model('School', [field('id', { isId: true })]),
      model('P', [field('id', { isId: true }), field('schoolId')]),
      model('C', [field('id', { isId: true }), field('schoolId'), field('pId'), rel('p', 'P', 'pId')]),
    ];
    expect(buildSchemaPlan(m).inboundRestricts.get('P')!.map((r) => r.childTable)).toEqual(['C']);
  });
});

describe('rows of a self-referencing table go in parents first', () => {
  const fk = [{ columns: ['parentId'], refModel: 'MenuItem', refTable: 'MenuItem', refColumns: ['id'], nullable: true, onDelete: 'Cascade' as const }];

  it('orders a deep chain written child-first', () => {
    const rows = [{ id: 'c', parentId: 'b' }, { id: 'b', parentId: 'a' }, { id: 'a', parentId: null }];
    expect(orderSelfReferencing(rows, 'id', fk).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not wait on a parent that is not in the set (it is checked as a dangling link instead)', () => {
    expect(orderSelfReferencing([{ id: 'x', parentId: 'elsewhere' }], 'id', fk).map((r) => r.id)).toEqual(['x']);
  });

  it('accepts a row that points at itself', () => {
    expect(orderSelfReferencing([{ id: 's', parentId: 's' }], 'id', fk)).toHaveLength(1);
  });

  it('refuses a cycle between rows instead of spinning forever', () => {
    expect(() => orderSelfReferencing([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }], 'id', fk)).toThrow(/cycle/);
  });
});
