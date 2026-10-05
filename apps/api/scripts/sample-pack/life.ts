import { randomUUID } from 'node:crypto';
import type { Prisma } from '@skoolos/db';
import { Ctx, many } from './ctx';
import { BOOKS, EVENTS, SCHOOL } from './data';
import { D, addDays } from './rng';

const AS_OF = D(SCHOOL.asOf);
const LOAN_DAYS = 14;
const GRACE = 1;
const PER_DAY = 5;
const LOST_FEE = 120;

/**
 * A school library that is in use: a catalogue with a few copies of each title,
 * and about 230 loans over four months — most returned on time, some returned
 * late with a fine, some out now, some overdue, and a few lost.
 */
export async function library(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  await p.librarySettings.create({
    data: { schoolId, loanDays: LOAN_DAYS, finePerDayRupees: PER_DAY, graceDays: GRACE, lostFeeRupees: LOST_FEE, studentLoanLimit: 2, teacherLoanLimit: 5 },
  });
  c.counts.LibrarySettings = 1;

  const titles = BOOKS.map(([title, author, shelf]) => ({ id: randomUUID(), schoolId, title, author, shelf }));
  await many(c, 'LibraryBookTitle', titles, (b) => p.libraryBookTitle.createMany({ data: b }));
  const copies: Prisma.LibraryBookCopyCreateManyInput[] = [];
  let acc = 1;
  for (const t of titles) {
    const n = r.int(2, 4);
    for (let k = 0; k < n; k += 1) copies.push({ id: randomUUID(), schoolId, titleId: t.id, accessionNo: `SPS-L-${String(acc++).padStart(4, '0')}` });
  }
  await many(c, 'LibraryBookCopy', copies, (b) => p.libraryBookCopy.createMany({ data: b }));

  // A copy is never out twice at once, and a student never holds more than two.
  const copyBusy = new Map<string, [number, number][]>();
  const borrowerBusy = new Map<string, [number, number][]>();
  const overlaps = (list: [number, number][] | undefined, a: number, b: number) =>
    (list ?? []).filter(([x, y]) => a <= y && b >= x).length;
  const FOREVER = 4_102_444_800_000;

  const students = c.students.filter((s) => s.gradeIdx >= 3);
  const teachers = c.teachers.slice(0, 8);
  const issues: Prisma.LibraryIssueCreateManyInput[] = [];
  const fines: Prisma.LibraryFineCreateManyInput[] = [];
  const lost: string[] = [];

  type Plan = { kind: 'ontime' | 'late' | 'current' | 'overdue' | 'lost'; n: number };
  const plan: Plan[] = [
    { kind: 'ontime', n: 125 }, { kind: 'late', n: 45 }, { kind: 'current', n: 24 }, { kind: 'overdue', n: 14 }, { kind: 'lost', n: 4 },
  ];
  for (const { kind, n } of plan) {
    for (let made = 0, tries = 0; made < n && tries < n * 40; tries += 1) {
      const teacherLoan = r.chance(0.06);
      const who = teacherLoan ? r.pick(teachers) : r.pick(students);
      const copy = r.pick(copies);
      let issuedOn: Date; let returnedOn: Date | null = null;
      if (kind === 'current') issuedOn = addDays(AS_OF, -r.int(1, 12));
      else if (kind === 'overdue') issuedOn = addDays(AS_OF, -r.int(22, 55));
      else if (kind === 'lost') issuedOn = addDays(AS_OF, -r.int(40, 90));
      else {
        issuedOn = addDays(D('2026-06-03'), r.int(0, 108));
        const due = addDays(issuedOn, LOAN_DAYS);
        returnedOn = kind === 'ontime' ? addDays(issuedOn, r.int(3, LOAN_DAYS)) : addDays(due, r.int(GRACE + 2, 12));
        if (returnedOn > AS_OF) continue;
      }
      if (issuedOn.getUTCDay() === 0) issuedOn = addDays(issuedOn, 1);
      const a = issuedOn.getTime();
      const b = returnedOn ? returnedOn.getTime() : FOREVER;
      if (overlaps(copyBusy.get(copy.id!), a, b)) continue;
      const limit = teacherLoan ? 5 : 2;
      if (overlaps(borrowerBusy.get(who.id), a, b) >= limit) continue;
      copyBusy.set(copy.id!, [...(copyBusy.get(copy.id!) ?? []), [a, b]]);
      borrowerBusy.set(who.id, [...(borrowerBusy.get(who.id) ?? []), [a, b]]);

      const id = randomUUID();
      const dueOn = addDays(issuedOn, LOAN_DAYS);
      issues.push({
        id, schoolId, copyId: copy.id!, ...(teacherLoan ? { teacherId: who.id } : { studentId: who.id }),
        issuedOn, dueOn, returnedOn, wasLost: kind === 'lost', issuedById: c.librarianUserId,
        returnedById: returnedOn ? c.librarianUserId : null, createdAt: issuedOn,
      });
      const owner = teacherLoan ? { teacherId: who.id } : { studentId: who.id };
      if (kind === 'late' && returnedOn) {
        const days = Math.floor((returnedOn.getTime() - dueOn.getTime()) / 86_400_000) - GRACE;
        const status = ((x) => (x < 0.6 ? 'PAID' : x < 0.85 ? 'DUE' : 'WAIVED'))(r.next()) as 'PAID' | 'DUE' | 'WAIVED';
        if (days > 0 && !teacherLoan) {
          fines.push({
            schoolId, issueId: id, ...owner, amountRupees: days * PER_DAY, reason: 'LATE', status,
            settledById: status === 'DUE' ? null : c.librarianUserId, settledAt: status === 'DUE' ? null : addDays(returnedOn, 1),
            createdAt: returnedOn,
          });
        }
      }
      if (kind === 'lost') {
        lost.push(copy.id!);
        fines.push({ schoolId, issueId: id, ...owner, amountRupees: LOST_FEE, reason: 'LOST', status: r.chance(0.5) ? 'PAID' : 'DUE', createdAt: addDays(issuedOn, 35) });
      }
      made += 1;
    }
  }
  await many(c, 'LibraryIssue', issues, (b) => p.libraryIssue.createMany({ data: b }));
  await many(c, 'LibraryFine', fines, (b) => p.libraryFine.createMany({ data: b }));
  if (lost.length) await p.libraryBookCopy.updateMany({ where: { id: { in: lost } }, data: { lostAt: addDays(AS_OF, -20) } });
}

/** The school calendar: past events with who came, upcoming ones with who has signed up, and house points. */
export async function events(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  const eventRows: Prisma.EventCreateManyInput[] = [];
  const tickets: Prisma.EventTicketTypeCreateManyInput[] = [];
  const regs: Prisma.EventRegistrationCreateManyInput[] = [];
  const at = (day: string, hm: string) => new Date(new Date(`${day}T${hm}:00.000Z`).getTime() - 330 * 60_000); // IST → UTC
  const ids = new Map<string, string>();

  for (const e of EVENTS) {
    const id = randomUUID();
    ids.set(e.title, id);
    const start = at(e.on, e.from);
    eventRows.push({
      id, schoolId, title: e.title, description: e.description, startAt: start, endAt: at(e.on, e.to), venue: e.venue,
      scope: 'SCHOOL', audienceKind: 'SCHOOL_ONLY', status: 'APPROVED',
      createdByUserId: c.officeUserId, approvedByUserId: c.officeUserId,
      approvedAt: addDays(start, -24), createdAt: addDays(start, -32),
    });
    const made = e.tickets.map((t) => ({ id: randomUUID(), name: t.name, capacity: t.capacity }));
    for (const t of made) {
      tickets.push({
        id: t.id, eventId: id, schoolId, name: t.name, priceMinor: 0, capacity: t.capacity,
        salesOpenAt: addDays(start, -30), salesCloseAt: addDays(start, -1), createdAt: addDays(start, -32),
      });
    }
    if (!e.registered) continue;
    // A ticket the students fit into: the first one with room for all of them.
    const ticket = made.find((t) => t.capacity >= e.registered) ?? made[made.length - 1]!;
    const chosen = r.shuffle(c.students.filter((s) => s.gradeIdx >= 3)).slice(0, Math.min(e.registered, ticket.capacity));
    for (const s of chosen) {
      regs.push({
        eventId: id, schoolId, ticketTypeId: ticket.id, studentId: s.id, quantity: 1, status: 'CONFIRMED',
        amountMinor: 0, paymentStatus: 'NOT_REQUIRED',
        checkedInAt: e.checkedIn ? addDays(start, 0) : null, createdAt: addDays(start, -r.int(2, 20)),
      });
    }
  }
  await many(c, 'Event', eventRows, (b) => p.event.createMany({ data: b }));
  await many(c, 'EventTicketType', tickets, (b) => p.eventTicketType.createMany({ data: b }));
  await many(c, 'EventRegistration', regs, (b) => p.eventRegistration.createMany({ data: b }));

  // House points: the Sports Day result, and merit points handed out through the term.
  const sports = ids.get('Inter-House Sports Day');
  const order = r.shuffle(c.houseIds);
  const points: Prisma.HousePointCreateManyInput[] = order.map((houseId, i) => ({
    schoolId, houseId, points: [120, 95, 70, 45][i]!, reason: `Inter-House Sports Day — ${['1st', '2nd', '3rd', '4th'][i]} place`,
    eventId: sports ?? null, createdAt: at('2026-09-19', '13:00'),
  }));
  const merit = ['Best attendance this month', 'Cleanest classroom', 'Quiz winners', 'Debate team', 'Best assembly performance', 'Library reading challenge', 'Plantation drive'];
  for (let k = 0; k < 40; k += 1) {
    points.push({
      schoolId, houseId: r.pick(c.houseIds), points: r.int(1, 5) * 5, reason: r.pick(merit),
      createdAt: addDays(AS_OF, -r.int(3, 100)),
    });
  }
  await many(c, 'HousePoint', points, (b) => p.housePoint.createMany({ data: b }));
}
