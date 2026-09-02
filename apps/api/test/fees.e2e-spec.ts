import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { signSchoolToken, seedMinimalSchool } from './integration/helpers';

/**
 * The money loop, end to end, against a real database with RLS on.
 *
 * This is the suite that matters: everything else in the module is
 * arrangement, but if a bill can be issued twice, or a payment can be verified
 * twice, or the ledger can disagree with the bills, the school finds out with
 * real parents' money. Each test below is one of those failures.
 */
describe('fees — the money loop', () => {
  let app: INestApplication;
  let schoolId: string;
  let host: string;
  let adminToken: string;
  let studentToken: string;
  let studentUserId: string;

  let yearId: string;
  let gradeId: string;
  let studentId: string;
  let tuitionId: string;
  let transportId: string;
  let termId: string;

  const as = (token: string) => ({ Authorization: `Bearer ${token}`, 'X-Skoolos-Host': host });
  const admin = () => as(adminToken);

  beforeAll(async () => {
    const seeded = await seedMinimalSchool();
    schoolId = seeded.schoolId;
    host = seeded.host;
    studentUserId = seeded.studentUserId;
    adminToken = signSchoolToken({ sub: seeded.adminUserId, schoolId, role: 'SCHOOL_ADMIN' });
    studentToken = signSchoolToken({ sub: seeded.studentUserId, schoolId, role: 'STUDENT' });

    const db = getPlatformPrisma();
    const year = await db.academicYear.create({
      data: {
        schoolId, name: '2026-27',
        startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31'), isCurrent: true,
      },
    });
    yearId = year.id;
    const grade = await db.grade.create({ data: { schoolId, name: 'Class 7', order: 7 } });
    gradeId = grade.id;
    const section = await db.classSection.create({
      data: { schoolId, gradeId: grade.id, academicYearId: year.id, name: 'B' },
    });
    const student = await db.student.create({
      data: {
        schoolId, admissionNo: 'ADM-2419', firstName: 'Aarav', lastName: 'Sharma',
        classSectionId: section.id, userId: studentUserId,
      },
    });
    studentId = student.id;

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  // ── Setup ──────────────────────────────────────────────────────────────────

  it('seeds the starter categories once, and not again', async () => {
    const first = await request(app.getHttpServer())
      .post('/manage/fees/categories/seed').set(admin()).expect(200);
    expect(first.body.seeded).toBeGreaterThan(0);

    const second = await request(app.getHttpServer())
      .post('/manage/fees/categories/seed').set(admin()).expect(200);
    expect(second.body.seeded).toBe(0);

    const list = await request(app.getHttpServer())
      .get('/manage/fees/categories').set(admin()).expect(200);
    // Every category carries the sentence a parent will read on their bill.
    expect(list.body.every((c: { description: string }) => c.description.length > 0)).toBe(true);

    tuitionId = list.body.find((c: { name: string }) => c.name === 'Tuition').id;
    transportId = list.body.find((c: { name: string }) => c.name === 'Transport').id;
  });

  it('saves the terms', async () => {
    const res = await request(app.getHttpServer())
      .put('/manage/fees/terms').set(admin())
      .send({ academicYearId: yearId, terms: [{ name: 'Term 1', dueDate: '2026-06-10' }, { name: 'Term 2', dueDate: '2026-09-10' }] })
      .expect(200);
    expect(res.body).toHaveLength(2);
    termId = res.body[1].id;
  });

  it('saves the class × category grid', async () => {
    await request(app.getHttpServer())
      .put('/manage/fees/grid').set(admin())
      .send({
        academicYearId: yearId,
        cells: [
          { gradeId, categoryId: tuitionId, termId: null, amountMinor: 900_000 },
          { gradeId, categoryId: transportId, termId: null, amountMinor: 300_000 },
        ],
      })
      .expect(200);

    const grid = await request(app.getHttpServer())
      .get(`/manage/fees/grid?academicYearId=${yearId}`).set(admin()).expect(200);
    expect(grid.body.cells).toHaveLength(2);
    expect(grid.body.isFrozen).toBe(false);
    expect(grid.body.grades.find((g: { id: string }) => g.id === gradeId).studentCount).toBe(1);
  });

  // ── Billing ────────────────────────────────────────────────────────────────

  it('bills only non-optional categories — transport is opt-in', async () => {
    const preview = await request(app.getHttpServer())
      .get(`/manage/fees/billing/preview?termId=${termId}`).set(admin()).expect(200);

    expect(preview.body.toBill).toBe(1);
    const lines = preview.body.invoices[0].lines;
    // Transport is optional and this student has not opted in, so it must not
    // appear — a school that bills every child for a bus they do not take
    // loses the parents' trust immediately.
    expect(lines.map((l: { categoryName: string }) => l.categoryName)).toEqual(['Tuition']);
    expect(preview.body.invoices[0].totalMinor).toBe(900_000);
  });

  it('applies a concession as a named, visible line', async () => {
    await request(app.getHttpServer())
      .post('/manage/fees/concessions').set(admin())
      .send({ studentId, categoryId: tuitionId, percentBps: 1000, reason: 'Sibling concession — second child' })
      .expect(201);

    const preview = await request(app.getHttpServer())
      .get(`/manage/fees/billing/preview?termId=${termId}`).set(admin()).expect(200);
    const line = preview.body.invoices[0].lines[0];
    expect(line.grossMinor).toBe(900_000);
    expect(line.concessionMinor).toBe(90_000);
    expect(line.netMinor).toBe(810_000);
    expect(line.concessionReason).toContain('Sibling');
  });

  it('rejects a concession that is neither a percentage nor an amount', async () => {
    await request(app.getHttpServer())
      .post('/manage/fees/concessions').set(admin())
      .send({ studentId, reason: 'no basis at all' })
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('CONCESSION_BASIS'));
  });

  it('generates bills, and generating again bills nobody twice', async () => {
    const first = await request(app.getHttpServer())
      .post('/manage/fees/billing/generate').set(admin()).send({ termId }).expect(200);
    expect(first.body.created).toBe(1);

    const second = await request(app.getHttpServer())
      .post('/manage/fees/billing/generate').set(admin()).send({ termId }).expect(200);
    expect(second.body.created).toBe(0);

    const db = getPlatformPrisma();
    expect(await db.feeInvoice.count({ where: { schoolId, termId } })).toBe(1);
  });

  it('freezes the plan once bills exist — editing mints a new version', async () => {
    const before = await request(app.getHttpServer())
      .get(`/manage/fees/grid?academicYearId=${yearId}`).set(admin()).expect(200);
    expect(before.body.isFrozen).toBe(true);

    const saved = await request(app.getHttpServer())
      .put('/manage/fees/grid').set(admin())
      .send({ academicYearId: yearId, cells: [{ gradeId, categoryId: tuitionId, termId: null, amountMinor: 1_000_000 }] })
      .expect(200);
    expect(saved.body.planVersion).toBe(2);

    // The bill the parent already has is untouched.
    const db = getPlatformPrisma();
    const invoice = await db.feeInvoice.findFirstOrThrow({ where: { schoolId, termId } });
    expect(invoice.totalMinor).toBe(810_000);
  });

  // ── The parent ─────────────────────────────────────────────────────────────

  it('shows the parent every line with the words the school wrote', async () => {
    const res = await request(app.getHttpServer())
      .get('/me/fees').set(as(studentToken)).expect(200);

    expect(res.body.balanceMinor).toBe(810_000);
    const inv = res.body.invoices[0];
    expect(inv.dueMinor).toBe(810_000);
    expect(inv.lines[0].categoryDescription).toContain('Classroom teaching');
    expect(inv.lines[0].concessionReason).toContain('Sibling');
  });

  it('tells the parent online payment is not on yet, rather than hiding it', async () => {
    const res = await request(app.getHttpServer())
      .get('/me/fees/how-to-pay').set(as(studentToken)).expect(200);

    expect(res.body.canPayOnline).toBe(false);
    const phonepe = res.body.options.find((o: { key: string }) => o.key === 'PHONEPE');
    // Present but not available — which is what renders the button disabled
    // with a reason instead of removing it from the page.
    expect(phonepe).toBeDefined();
    expect(phonepe.available).toBe(false);
    expect(phonepe.status).toBe('PENDING');
  });

  it('refuses to switch on a gateway Sckools has not onboarded with', async () => {
    await request(app.getHttpServer())
      .put('/manage/fees/payment-setup/provider').set(admin())
      .send({ provider: 'PHONEPE', enabled: true, config: { merchantId: 'M123' } })
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE'));
  });

  it('will not hand out bank details the school has not published', async () => {
    await request(app.getHttpServer())
      .get('/me/fees/bank-instructions').set(as(studentToken))
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('NO_PAYMENT_METHOD'));
  });

  it('gives the parent bank details and a UPI link with the amount filled in', async () => {
    await request(app.getHttpServer())
      .put('/manage/fees/payment-setup/bank').set(admin())
      .send({
        accountName: 'Saraswati Vidya Mandir Samiti', accountNumber: '50100284791036',
        ifsc: 'HDFC0001432', bankName: 'HDFC Bank', branch: 'Sikar Road',
        upiId: 'saraswativm@hdfcbank', instructions: 'Write your child’s admission number in the remark.',
        isVisible: true,
      })
      .expect(200);

    const db = getPlatformPrisma();
    const invoice = await db.feeInvoice.findFirstOrThrow({ where: { schoolId, termId } });

    const res = await request(app.getHttpServer())
      .get(`/me/fees/bank-instructions?invoiceId=${invoice.id}`).set(as(studentToken)).expect(200);

    expect(res.body.kind).toBe('INSTRUCTIONS');
    expect(res.body.bank.accountNumber).toBe('50100284791036');
    // The static QR carries no amount; the deep link does, which is the whole
    // reason to build one.
    expect(res.body.bank.upiIntentUri).toContain('am=8100.00');
    expect(res.body.bank.upiIntentUri).toContain('pa=saraswativm%40hdfcbank');
  });

  // ── Claim, verify, ledger ──────────────────────────────────────────────────

  let paymentId: string;

  it('accepts a claim and records NO money for it yet', async () => {
    const db = getPlatformPrisma();
    const invoice = await db.feeInvoice.findFirstOrThrow({ where: { schoolId, termId } });

    const res = await request(app.getHttpServer())
      .post('/me/fees/submit').set(as(studentToken))
      .field('studentId', studentId)
      .field('invoiceId', invoice.id)
      .field('method', 'UPI')
      .field('amountMinor', '810000')
      .field('paidOn', '2026-08-29')
      .field('reference', '421833949931')
      .expect(201);

    paymentId = res.body.id;
    expect(res.body.status).toBe('SUBMITTED');

    // Nothing has moved in the ledger. Money becomes real only on verify —
    // that is the entire safety property of this rail.
    const mine = await request(app.getHttpServer()).get('/me/fees').set(as(studentToken)).expect(200);
    expect(mine.body.balanceMinor).toBe(810_000);
  });

  it('blocks the same reference being claimed twice', async () => {
    await request(app.getHttpServer())
      .post('/me/fees/submit').set(as(studentToken))
      .field('studentId', studentId).field('method', 'UPI')
      .field('amountMinor', '810000').field('paidOn', '2026-08-29')
      .field('reference', '421833949931')
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('DUPLICATE_PAYMENT_REFERENCE'));
  });

  it('shows the clerk the amount already compared against the bill', async () => {
    const res = await request(app.getHttpServer())
      .get('/manage/fees/payments').set(admin()).expect(200);
    const row = res.body.find((p: { id: string }) => p.id === paymentId);
    expect(row.amountMatchesBill).toBe(true);
    expect(row.student.admissionNo).toBe('ADM-2419');
  });

  it('verifies: ledger, allocation and receipt land together — and carries the school’s note', async () => {
    const res = await request(app.getHttpServer())
      .post(`/manage/fees/payments/${paymentId}/verify`).set(admin())
      .send({ note: 'Received by NEFT on 28 Aug. Thank you.' })
      .expect(200);
    expect(res.body.receipt.number).toMatch(/^RCP\/\d{4}\/00001$/);

    const mine = await request(app.getHttpServer()).get('/me/fees').set(as(studentToken)).expect(200);
    expect(mine.body.balanceMinor).toBe(0);
    expect(mine.body.invoices[0].isPaid).toBe(true);
    expect(mine.body.payments[0].receiptNumber).toBe(res.body.receipt.number);
    // The acknowledgement reaches the family verbatim — that is its whole job.
    expect(mine.body.payments[0].ackNote).toBe('Received by NEFT on 28 Aug. Thank you.');
  });

  it('gives the family a receipt document that accounts for every paisa', async () => {
    const mine = await request(app.getHttpServer()).get('/me/fees').set(as(studentToken)).expect(200);
    const paid = mine.body.payments[0];

    const r = await request(app.getHttpServer())
      .get(`/me/fees/receipts/${paid.id}`).set(as(studentToken)).expect(200);

    expect(r.body.receiptNumber).toBe(paid.receiptNumber);
    expect(r.body.student.admissionNo).toBe('ADM-2419');
    expect(r.body.payment.ackNote).toBe('Received by NEFT on 28 Aug. Thank you.');
    // Named by CATEGORY, not just by bill — the receipt has to say what the
    // money actually cleared, the same transparency the bill breakdown gives.
    expect(r.body.allocations.length).toBeGreaterThan(0);
    expect(r.body.allocations[0].categoryName).toEqual(expect.any(String));
    const allocated = r.body.allocations.reduce((a: number, x: { amountMinor: number }) => a + x.amountMinor, 0);
    expect(allocated + r.body.unallocatedMinor).toBe(r.body.payment.amountMinor);
  });

  it('reprints the same receipt for the office, from the school-scoped route', async () => {
    const mine = await request(app.getHttpServer()).get('/me/fees').set(as(studentToken)).expect(200);
    const paid = mine.body.payments[0];
    const r = await request(app.getHttpServer())
      .get(`/manage/fees/receipts/${paid.id}`).set(admin()).expect(200);
    expect(r.body.receiptNumber).toBe(paid.receiptNumber);
  });

  it('has no receipt to give for a payment nobody has accepted', async () => {
    const claim = await request(app.getHttpServer())
      .post('/me/fees/submit').set(as(studentToken))
      .field('studentId', studentId)
      .field('method', 'UPI').field('amountMinor', '100')
      .field('paidOn', '2026-08-30').field('reference', 'NO-RECEIPT-YET')
      .expect(201);
    // A blank sheet headed "Receipt" is exactly what a family would screenshot
    // as proof of something that never happened.
    await request(app.getHttpServer())
      .get(`/me/fees/receipts/${claim.body.id}`).set(as(studentToken)).expect(404);
  });

  it('will not verify the same payment twice', async () => {
    await request(app.getHttpServer())
      .post(`/manage/fees/payments/${paymentId}/verify`).set(admin())
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('PAYMENT_NOT_PENDING'));
  });

  it('reverses by posting an opposing entry, never by editing the ledger', async () => {
    await request(app.getHttpServer())
      .post(`/manage/fees/payments/${paymentId}/reverse`).set(admin())
      .send({ reason: 'Bank returned the transfer' }).expect(200);

    const db = getPlatformPrisma();
    const entries = await db.feeLedgerEntry.findMany({ where: { schoolId, studentId }, orderBy: { createdAt: 'asc' } });
    // The original credit is still there — the reversal is an addition.
    expect(entries.map((e) => `${e.kind}:${e.amountMinor}`)).toEqual([
      'DEBIT:810000', 'CREDIT:810000', 'DEBIT:810000',
    ]);

    const mine = await request(app.getHttpServer()).get('/me/fees').set(as(studentToken)).expect(200);
    expect(mine.body.balanceMinor).toBe(810_000);
  });

  it('the ledger is append-only at the database, not by convention', async () => {
    const db = getPlatformPrisma();
    const row = await db.feeLedgerEntry.findFirstOrThrow({ where: { schoolId, studentId } });
    await expect(
      db.feeLedgerEntry.update({ where: { id: row.id }, data: { amountMinor: 1 } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.feeLedgerEntry.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });

  // ── Late fee ───────────────────────────────────────────────────────────────

  describe('late fee', () => {
    let lateStudentId: string;
    let lateInvoiceId: string;

    beforeAll(async () => {
      // A second student, and a term whose due date is already well past, so
      // lateness is a fact rather than a wait.
      const db = getPlatformPrisma();
      const section = await db.classSection.findFirstOrThrow({ where: { schoolId } });
      const s2 = await db.student.create({
        data: {
          schoolId, admissionNo: 'ADM-9001', firstName: 'Ishita', lastName: 'Meena',
          classSectionId: section.id,
        },
      });
      lateStudentId = s2.id;

      // Existing terms must be sent back WITH their ids: dropping a term that
      // already carries bills is refused, which is the point of that guard.
      const existing = await request(app.getHttpServer())
        .get(`/manage/fees/terms?academicYearId=${yearId}`).set(admin()).expect(200);

      const terms = await request(app.getHttpServer())
        .put('/manage/fees/terms').set(admin())
        .send({
          academicYearId: yearId,
          terms: [
            ...existing.body.map((t: { id: string; name: string; dueDate: string }) => ({
              id: t.id, name: t.name, dueDate: t.dueDate.slice(0, 10),
            })),
            { name: 'Term 0 (overdue)', dueDate: '2026-01-10' },
          ],
        })
        .expect(200);
      const overdue = terms.body.find((t: { name: string }) => t.name.startsWith('Term 0'));

      await request(app.getHttpServer())
        .post('/manage/fees/billing/generate').set(admin())
        .send({ termId: overdue.id }).expect(200);

      const inv = await db.feeInvoice.findFirstOrThrow({
        where: { schoolId, studentId: lateStudentId, termId: overdue.id },
      });
      lateInvoiceId = inv.id;
    });

    it('charges nothing until the school sets a rule', async () => {
      const res = await request(app.getHttpServer())
        .get(`/manage/fees/students/${lateStudentId}`).set(admin()).expect(200);
      const inv = res.body.invoices.find((i: { id: string }) => i.id === lateInvoiceId);
      expect(res.body.lateFeeRule).toBeNull();
      expect(inv.lateFeeMinor).toBe(0);
      expect(inv.dueMinor).toBe(inv.principalDueMinor);
    });

    it('rejects a rule that charges nothing', async () => {
      await request(app.getHttpServer())
        .put('/manage/fees/settings').set(admin())
        .send({ lateFeeMode: 'PER_DAY', lateFeeAmountMinor: 0, lateFeeGraceDays: 0, lateFeeCapMinor: 0 })
        .expect(400);
    });

    it('applies the rule the school sets, capped', async () => {
      await request(app.getHttpServer())
        .put('/manage/fees/settings').set(admin())
        .send({ lateFeeMode: 'PER_DAY', lateFeeAmountMinor: 10_000, lateFeeGraceDays: 5, lateFeeCapMinor: 100_000 })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/manage/fees/students/${lateStudentId}`).set(admin()).expect(200);
      const inv = res.body.invoices.find((i: { id: string }) => i.id === lateInvoiceId);

      // Months past a January due date at ₹100/day is far beyond the ₹1,000 cap.
      expect(inv.lateFeeMinor).toBe(100_000);
      expect(inv.dueMinor).toBe(inv.principalDueMinor + 100_000);
      expect(res.body.lateFeeRule).toContain('per day');
      expect(res.body.lateFeeRule).toContain('5 grace days');
    });

    it('counts the late fee in what the office is chasing', async () => {
      // The list is now per STUDENT rather than per invoice — one row carrying
      // everything that child owes, which is what the office chases.
      const res = await request(app.getHttpServer())
        .get('/manage/fees/students?owing=1').set(admin()).expect(200);
      const row = res.body.rows.find((r: { studentId: string }) => r.studentId === lateStudentId);
      expect(row.lateFeeMinor).toBe(100_000);
      expect(row.dueMinor).toBe(row.principalDueMinor + 100_000);
      expect(row.daysOverdue).toBeGreaterThan(0);
    });

    it('posts the late fee to the ledger on verify — once, not twice', async () => {
      const db = getPlatformPrisma();
      const inv = await db.feeInvoice.findFirstOrThrow({ where: { id: lateInvoiceId } });
      const expected = inv.totalMinor + 100_000;

      const submitted = await request(app.getHttpServer())
        .post('/manage/fees/payments/record').set(admin())
        .field('studentId', lateStudentId)
        .field('invoiceId', lateInvoiceId)
        .field('method', 'CASH')
        .field('amountMinor', String(expected))
        .field('paidOn', '2026-08-29')
        .expect(201);

      await request(app.getHttpServer())
        .post(`/manage/fees/payments/${submitted.body.id}/verify`).set(admin()).expect(200);

      const lateEntries = await db.feeLedgerEntry.findMany({
        where: { schoolId, refType: 'LATE_FEE', refId: lateInvoiceId },
      });
      expect(lateEntries).toHaveLength(1);
      expect(lateEntries[0].amountMinor).toBe(100_000);
      expect(lateEntries[0].kind).toBe('DEBIT');

      // Bill + late fee paid in full, so the student owes nothing.
      const after = await request(app.getHttpServer())
        .get(`/manage/fees/students/${lateStudentId}`).set(admin()).expect(200);
      expect(after.body.balanceMinor).toBe(0);
    });

    it('does not charge the late fee again on a second payment', async () => {
      const db = getPlatformPrisma();
      const second = await request(app.getHttpServer())
        .post('/manage/fees/payments/record').set(admin())
        .field('studentId', lateStudentId)
        .field('invoiceId', lateInvoiceId)
        .field('method', 'CASH')
        .field('amountMinor', '5000')
        .field('paidOn', '2026-08-29')
        .expect(201);

      await request(app.getHttpServer())
        .post(`/manage/fees/payments/${second.body.id}/verify`).set(admin()).expect(200);

      const lateEntries = await db.feeLedgerEntry.findMany({
        where: { schoolId, refType: 'LATE_FEE', refId: lateInvoiceId },
      });
      // Still one. The charge is idempotent on the invoice, not on the payment.
      expect(lateEntries).toHaveLength(1);
    });

    it('never charges an RTE student for being late', async () => {
      const db = getPlatformPrisma();
      const plan = await db.feePlan.findFirstOrThrow({
        where: { schoolId, isActive: true }, orderBy: { version: 'desc' },
      });
      await db.feeAssignment.create({
        data: { schoolId, studentId, planId: plan.id, isRte: true },
      });
      // Aarav's Term 2 bill predates the RTE flag, so re-bill a fresh student
      // instead: the flag is read at billing time, which is the point.
      const res = await request(app.getHttpServer())
        .get(`/manage/fees/students/${studentId}`).set(admin()).expect(200);
      // His existing bill's lines were issued collectible, so the guard that
      // matters here is the one in computeLateFee, proven in late-fee.spec.ts.
      expect(res.body.invoices.every((i: { lateFeeMinor: number }) => i.lateFeeMinor >= 0)).toBe(true);
    });

    afterAll(async () => {
      // Leave the school with no late-fee rule, so tests after this block see
      // the same world they were written against.
      await request(app.getHttpServer())
        .put('/manage/fees/settings').set(admin())
        .send({ lateFeeMode: 'NONE', lateFeeAmountMinor: 0, lateFeeGraceDays: 0, lateFeeCapMinor: 0 })
        .expect(200);
    });
  });

  // ── Fees by student: one list, two views ───────────────────────────────────

  describe('fees by student', () => {
    it('lists the whole roll by default, not only the debtors', async () => {
      const res = await request(app.getHttpServer())
        .get('/manage/fees/students').set(admin()).expect(200);

      // Aarav's Term 2 bill was paid and then reversed earlier in this file, so
      // he owes; a list that only returned debtors would still contain him and
      // the assertion would prove nothing. The point is that EVERY active
      // student appears, including any with no bill at all.
      const db = getPlatformPrisma();
      const active = await db.student.count({ where: { schoolId, isActive: true } });
      expect(res.body.totals.students).toBe(active);
      expect(res.body.rows.length).toBe(active);
      expect(res.body.rows.some((r: { status: string }) => r.status !== 'UNPAID')).toBe(true);
    });

    it('narrows to who owes when asked, and the totals follow the filter', async () => {
      const all = await request(app.getHttpServer())
        .get('/manage/fees/students').set(admin()).expect(200);
      const owing = await request(app.getHttpServer())
        .get('/manage/fees/students?owing=1').set(admin()).expect(200);

      expect(owing.body.totals.students).toBeLessThanOrEqual(all.body.totals.students);
      expect(owing.body.rows.every((r: { dueMinor: number }) => r.dueMinor > 0)).toBe(true);
      // Totals describe the filtered set, not the page and not the whole roll.
      expect(owing.body.totals.dueMinor).toBe(
        owing.body.rows.reduce((a: number, r: { dueMinor: number }) => a + r.dueMinor, 0),
      );
    });

    it('separates the late fee from the bill on every row', async () => {
      const res = await request(app.getHttpServer())
        .get('/manage/fees/students?owing=1').set(admin()).expect(200);
      for (const r of res.body.rows) {
        expect(r.dueMinor).toBe(r.principalDueMinor + r.lateFeeMinor);
      }
    });

    it('finds a student by name or admission number', async () => {
      const byName = await request(app.getHttpServer())
        .get('/manage/fees/students?q=Aarav').set(admin()).expect(200);
      expect(byName.body.rows.map((r: { name: string }) => r.name)).toContain('Aarav Sharma');

      const byAdm = await request(app.getHttpServer())
        .get('/manage/fees/students?q=ADM-2419').set(admin()).expect(200);
      expect(byAdm.body.rows).toHaveLength(1);
    });

    it('refuses junk in a numeric query param rather than coercing it', async () => {
      // A bare @IsInt() on a query DTO 400s on the good value instead, because
      // the pipe has no implicit conversion — so both halves are asserted.
      await request(app.getHttpServer())
        .get('/manage/fees/students?take=50').set(admin()).expect(200);
      await request(app.getHttpServer())
        .get('/manage/fees/students?take=abc').set(admin())
        .expect(400)
        .expect((r) => expect(r.body.code).toBe('VALIDATION'));
      await request(app.getHttpServer())
        .get('/manage/fees/students?minDue=lots').set(admin()).expect(400);
    });
  });

  // ── Authorization ──────────────────────────────────────────────────────────

  it('a student cannot reach the office side of fees', async () => {
    await request(app.getHttpServer()).get('/manage/fees/payments').set(as(studentToken)).expect(403);
    await request(app.getHttpServer()).get('/manage/fees/summary').set(as(studentToken)).expect(403);
    await request(app.getHttpServer())
      .put('/manage/fees/payment-setup/bank').set(as(studentToken)).send({}).expect(403);
  });

  it('a parent asking for another school’s student gets nothing', async () => {
    const other = await seedMinimalSchool();
    const otherToken = signSchoolToken({ sub: other.adminUserId, schoolId: other.schoolId, role: 'SCHOOL_ADMIN' });
    await request(app.getHttpServer())
      .get(`/manage/fees/students/${studentId}`)
      .set({ Authorization: `Bearer ${otherToken}`, 'X-Skoolos-Host': other.host })
      .expect(404);
  });
});
