/**
 * A whole school, with enough in it to be worth looking at.
 *
 * The alumni seed proved the point in one wing: an empty screen tells you
 * nothing about whether a feature works. Beacon on staging had ONE active
 * student, so every gift headcount read "1" and the gifting screens — which are
 * entirely about covering a whole class — looked broken while being correct.
 *
 * So this builds a plausible Indian day school end to end: ten grades, two
 * sections each, a real roll, a timetable that resolves, attendance with actual
 * absences in it, marks that vary, a library with books out and overdue, and a
 * term's worth of notices. Every screen then has something true to render.
 *
 * Re-runnable: every write is keyed on something stable.
 *
 * NOT for production. It writes people who do not exist and logins with known
 * passwords, which is why the workflow that runs it has no production option.
 *
 * Connection resolution: see seed-alumni-demo.ts. ONE variable decides, pinned
 * onto all three before any client is built, because @skoolos/db reads
 * DATABASE_URL_APP / DATABASE_URL_PLATFORM first and a half-set environment
 * silently writes to the wrong database.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function dotenvValue(key: string): string | undefined {
  const path = resolve(__dirname, '../../../.env');
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`).exec(line);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}
const DB_URL = process.env.DATABASE_URL ?? dotenvValue('DATABASE_URL');
if (!DB_URL) throw new Error('DATABASE_URL must be set (in the environment, or in a root .env).');
process.env.DATABASE_URL = DB_URL;
process.env.DATABASE_URL_APP = DB_URL;
process.env.DATABASE_URL_PLATFORM = DB_URL;

import { getPlatformPrisma, withTenant, disconnectAll } from '@skoolos/db';
import { hash } from 'argon2';

const SLUG = process.env.DEMO_SCHOOL_SLUG ?? 'raffles';
const NAME = process.env.DEMO_SCHOOL_NAME ?? 'Raffles International School';
const HOST = process.env.DEMO_HOSTNAME ?? `${SLUG}.test.sckools.com`;
const PW = process.env.DEMO_PASSWORD ?? 'Passw0rd!';
const DRY_RUN = process.env.DEMO_DRY_RUN === 'true';

/** Deterministic, so re-running produces the same school rather than a
 *  different one — and so a screenshot from yesterday still matches. */
let seed = 20260827;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);
const daysAhead = (n: number) => new Date(Date.now() + n * 864e5);

const FIRST_M = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Rudra',
  'Kabir', 'Aryan', 'Dhruv', 'Neel', 'Yash', 'Om', 'Rohan', 'Kian', 'Advait', 'Parth'];
const FIRST_F = ['Aadhya', 'Ananya', 'Diya', 'Ira', 'Myra', 'Anika', 'Navya', 'Kiara', 'Saanvi', 'Pari',
  'Riya', 'Aisha', 'Meera', 'Tara', 'Nitya', 'Avni', 'Ishita', 'Zara', 'Naina', 'Sara'];
const LAST = ['Sharma', 'Verma', 'Patel', 'Reddy', 'Nair', 'Iyer', 'Mehta', 'Joshi', 'Kulkarni', 'Desai',
  'Chauhan', 'Bhosale', 'Pillai', 'Ansari', 'Qureshi', 'Gupta', 'Bose', 'Rao', 'Menon', 'Kapoor'];
const CITY_AREAS = ['Koregaon Park', 'Baner', 'Aundh', 'Viman Nagar', 'Kothrud', 'Hadapsar', 'Wakad'];

const SUBJECTS = [
  ['English', 'ENG'], ['Mathematics', 'MATH'], ['Science', 'SCI'], ['Social Studies', 'SST'],
  ['Hindi', 'HIN'], ['Marathi', 'MAR'], ['Computer Science', 'CS'], ['Physical Education', 'PE'],
  ['Art & Craft', 'ART'], ['Music', 'MUS'],
] as const;

const PERIODS = [
  ['I', '08:00', '08:45'], ['II', '08:45', '09:30'], ['III', '09:30', '10:15'],
  ['Break', '10:15', '10:35'], ['IV', '10:35', '11:20'], ['V', '11:20', '12:05'],
  ['VI', '12:05', '12:50'], ['VII', '12:50', '13:35'],
] as const;

async function main() {
  const platform = getPlatformPrisma();

  let school = await platform.school.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });

  if (DRY_RUN) {
    const where = await platform.$queryRawUnsafe<{ db: string; usr: string }[]>(
      'select current_database() as db, current_user as usr',
    );
    console.log(`  connected to: ${where[0]?.db} as ${where[0]?.usr}`);
    console.log('  DRY RUN — nothing will be written. This run would:');
    console.log(`    · ${school ? 'update' : 'CREATE'} the school "${NAME}" (${SLUG}) at ${HOST}`);
    console.log('    · turn on every feature, build 10 grades × 2 sections, ~480 students');
    console.log('    · seed timetable, attendance, exams, marks, library, events, notices and more');
    return;
  }

  if (!school) {
    school = await platform.school.create({
      data: { slug: SLUG, name: NAME, tier: 'PRO', status: 'LIVE' },
      select: { id: true, name: true },
    });
    console.log(`  ✓ created the school`);
  }
  const schoolId = school.id;
  console.log(`→ ${school.name} (${SLUG})`);

  await platform.domain.upsert({
    where: { hostname: HOST },
    update: { schoolId },
    create: { schoolId, hostname: HOST },
  });
  console.log(`  ✓ ${HOST}`);

  const step = <T>(fn: (db: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) =>
    withTenant(schoolId, fn);

  // ── Features ───────────────────────────────────────────────────────────────
  // A demo school with half its wings switched off demonstrates the tier logic,
  // not the product.
  const FEATURES = ['MANAGEMENT', 'PUBLIC_SITE', 'ABOUT_CONTACT', 'ENQUIRY', 'EVENTS',
    'GALLERY', 'SOCIAL', 'BLOG', 'HIRING', 'LIBRARY', 'ALUMNI'] as const;
  for (const featureKey of FEATURES) {
    await step(async (db) => {
      const found = await db.featureOverride.findFirst({ where: { schoolId, featureKey } });
      if (found) await db.featureOverride.update({ where: { id: found.id }, data: { enabled: true } });
      else await db.featureOverride.create({ data: { schoolId, featureKey, enabled: true } });
    });
  }
  console.log(`  ✓ ${FEATURES.length} features on`);

  // ── The public site ────────────────────────────────────────────────────────
  await step(async (db) => {
    await db.schoolProfile.upsert({
      where: { schoolId },
      update: {},
      create: {
        schoolId,
        addressLine1: '9 Boat Club Road',
        city: 'Pune', region: 'Maharashtra', postalCode: '411001', country: 'India',
        phone: '+91 20 2612 3400', email: `office@${SLUG}.example.com`,
        // A brand that is NOT the default, so this school looks like a
        // different school — which is the point of a second demo tenant.
        brandColorPrimary: '#1f6feb', brandColorSecondary: '#f2a33c',
      },
    });
    await db.homepageContent.upsert({
      where: { schoolId }, update: {},
      create: {
        schoolId,
        headline: 'A school that still knows every child by name',
        subheadline: 'CBSE · Nursery to Class X · Pune',
        aboutText:
          `${NAME} has taught the children of ${CITY_AREAS[0]} since 1974. Two sections a year, `
          + 'never more, because a teacher who knows every name teaches better than one who does not.',
        principalName: 'Mrs. Anjali Deshpande',
        principalMessage:
          'We are not trying to be the largest school in Pune. We are trying to be the one where '
          + 'your child is known.',
      },
    });
    await db.admissionsSettings.upsert({ where: { schoolId }, update: {}, create: { schoolId, showFeesPublicly: true } });
  });

  for (const [i, [label, value]] of ([
    ['Founded', '1974'], ['Children', '480'], ['Teachers', '24'], ['Class size', '24'],
  ] as const).entries()) {
    await step(async (db) => {
      const has = await db.statItem.findFirst({ where: { schoolId, label } });
      if (!has) await db.statItem.create({ data: { schoolId, label, value, order: i } });
    });
  }

  for (const [i, [title, description]] of ([
    ['Enquire', 'Tell us about your child and we will call you within two working days.'],
    ['Visit', 'Come and see a normal Tuesday, not an open day.'],
    ['Assessment', 'An informal hour with the class teacher. No coaching required, and none helps.'],
    ['Offer', 'A written offer, with the fee schedule in full and nothing extra later.'],
  ] as const).entries()) {
    await step(async (db) => {
      const has = await db.admissionStep.findFirst({ where: { schoolId, title } });
      if (!has) await db.admissionStep.create({ data: { schoolId, title, description, order: i } });
    });
  }

  const COURSES = [
    ['Pre-primary', 'Nursery to Senior KG', '₹48,000 a year'],
    ['Primary', 'Classes I to V', '₹62,000 a year'],
    ['Middle school', 'Classes VI to VIII', '₹74,000 a year'],
    ['Secondary', 'Classes IX and X', '₹86,000 a year'],
  ] as const;
  for (const [i, [name, tagline, annualFee]] of COURSES.entries()) {
    await step(async (db) => {
      const existing = await db.course.findFirst({ where: { schoolId, name } });
      if (existing) return;
      const c = await db.course.create({ data: { schoolId, name, tagline, order: i, featured: i < 2 } });
      await db.courseFee.create({
        data: { schoolId, courseId: c.id, annualFee, admissionFee: '₹25,000 once', includes: 'Tuition, books and one uniform set.' },
      });
    });
  }
  console.log('  ✓ public site: profile, stats, admissions, 4 courses');

  // ── The academic frame ─────────────────────────────────────────────────────
  const year = await step(async (db) => {
    const found = await db.academicYear.findFirst({ where: { schoolId, name: '2026-27' } });
    return found ?? db.academicYear.create({
      data: { schoolId, name: '2026-27', startDate: d('2026-04-01'), endDate: d('2027-03-31'), isCurrent: true },
    });
  });

  const subjects = [];
  for (const [name, code] of SUBJECTS) {
    subjects.push(await step(async (db) => {
      const found = await db.subject.findFirst({ where: { schoolId, code } });
      return found ?? db.subject.create({ data: { schoolId, name, code } });
    }));
  }

  const periods = [];
  for (const [i, [label, startTime, endTime]] of PERIODS.entries()) {
    periods.push(await step(async (db) => {
      const found = await db.period.findFirst({ where: { schoolId, order: i + 1 } });
      return found ?? db.period.create({ data: { schoolId, order: i + 1, label, startTime, endTime } });
    }));
  }
  const teaching = periods.filter((p) => p.label !== 'Break');

  const GRADES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  const sections: { id: string; label: string; gradeName: string }[] = [];
  for (const [gi, gname] of GRADES.entries()) {
    const grade = await step(async (db) => {
      const found = await db.grade.findFirst({ where: { schoolId, name: gname } });
      return found ?? db.grade.create({ data: { schoolId, name: gname, order: gi + 1 } });
    });
    for (const sname of ['A', 'B']) {
      const sec = await step(async (db) => {
        const found = await db.classSection.findFirst({
          where: { schoolId, gradeId: grade.id, name: sname, academicYearId: year.id },
        });
        return found ?? db.classSection.create({
          data: { schoolId, gradeId: grade.id, name: sname, academicYearId: year.id },
        });
      });
      sections.push({ id: sec.id, label: `${gname}-${sname}`, gradeName: gname });
    }
  }
  console.log(`  ✓ ${GRADES.length} grades, ${sections.length} sections, ${subjects.length} subjects, ${periods.length} periods`);

  // ── Teachers, staff and their logins ───────────────────────────────────────
  const passwordHash = await hash(PW);
  const teachers: { id: string; name: string }[] = [];
  for (let i = 0; i < 24; i += 1) {
    const firstName = pick(i % 2 ? FIRST_F : FIRST_M);
    const lastName = pick(LAST);
    const email = `teacher${i + 1}@${SLUG}.test`;
    const t = await step(async (db) => {
      const found = await db.teacher.findFirst({ where: { schoolId, email } });
      if (found) return found;
      const user = await db.user.create({ data: { schoolId, email, passwordHash, role: 'TEACHER' } });
      return db.teacher.create({
        data: {
          schoolId, firstName, lastName, email, userId: user.id,
          phone: `+9198${between(10000000, 99999999)}`,
        },
      });
    });
    teachers.push({ id: t.id, name: `${firstName} ${lastName}` });
    // Each teacher owns two subjects, so the timetable can be built from a real
    // competence map rather than at random.
    await step(async (db) => {
      for (const s of [subjects[i % subjects.length]!, subjects[(i + 3) % subjects.length]!]) {
        const has = await db.teacherSubject.findFirst({ where: { schoolId, teacherId: t.id, subjectId: s.id } });
        if (!has) await db.teacherSubject.create({ data: { schoolId, teacherId: t.id, subjectId: s.id } });
      }
    });
  }

  const STAFF: [string, string, 'OFFICE' | 'LIBRARIAN' | 'SUPPORT' | 'DRIVER' | 'SECURITY'][] = [
    ['Sunita', 'Kale', 'OFFICE'], ['Ramesh', 'Pawar', 'LIBRARIAN'], ['Asha', 'Gaikwad', 'OFFICE'],
    ['Vijay', 'More', 'DRIVER'], ['Latha', 'Shinde', 'SUPPORT'], ['Prakash', 'Jadhav', 'SECURITY'],
  ];
  for (const [firstName, lastName, role] of STAFF) {
    await step(async (db) => {
      const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${SLUG}.test`;
      const found = await db.staff.findFirst({ where: { schoolId, email } });
      if (found) return;
      const user = await db.user.create({ data: { schoolId, email, passwordHash, role: 'STAFF' } });
      await db.staff.create({ data: { schoolId, firstName, lastName, email, role, userId: user.id } });
    });
  }

  // The admin login for the console.
  await step(async (db) => {
    const email = `admin@${SLUG}.test`;
    const found = await db.user.findFirst({ where: { schoolId, email } });
    if (found) await db.user.update({ where: { id: found.id }, data: { passwordHash, role: 'SCHOOL_ADMIN' } });
    else await db.user.create({ data: { schoolId, email, passwordHash, role: 'SCHOOL_ADMIN' } });
  });
  console.log(`  ✓ ${teachers.length} teachers, ${STAFF.length} staff, 1 admin — all password ${PW}`);

  // ── The roll ───────────────────────────────────────────────────────────────
  // createMany per section: 480 individual inserts inside interactive
  // transactions would blow the five-second ceiling several times over.
  let admission = 20260001;
  const roll: { id: string; sectionId: string }[] = [];
  for (const sec of sections) {
    const size = between(22, 27);
    const rows = Array.from({ length: size }, (_, i) => {
      const female = i % 2 === 1;
      const firstName = pick(female ? FIRST_F : FIRST_M);
      const lastName = pick(LAST);
      return {
        schoolId,
        admissionNo: `R/${admission++}`,
        firstName, lastName,
        classSectionId: sec.id,
        rollNo: String(i + 1),
        gender: female ? 'F' : 'M',
        dob: d(`${2026 - 5 - GRADES.indexOf(sec.gradeName)}-0${between(1, 9)}-1${between(0, 9)}`),
        guardianName: `${pick(FIRST_M)} ${lastName}`,
        guardianPhone: `+9199${between(10000000, 99999999)}`,
        isActive: true,
      };
    });
    await step(async (db) => {
      const already = await db.student.count({ where: { schoolId, classSectionId: sec.id } });
      if (already > 0) return;
      await db.student.createMany({ data: rows, skipDuplicates: true });
    });
    const made = await step((db) =>
      db.student.findMany({ where: { schoolId, classSectionId: sec.id }, select: { id: true } }));
    for (const s of made) roll.push({ id: s.id, sectionId: sec.id });
  }
  console.log(`  ✓ ${roll.length} students on the roll`);

  // ── Timetable ──────────────────────────────────────────────────────────────
  await step(async (db) => {
    const already = await db.timetableSlot.count({ where: { schoolId } });
    if (already > 0) return;
    const slots: Record<string, unknown>[] = [];
    for (const [si, sec] of sections.entries()) {
      for (let day = 1; day <= 5; day += 1) {
        for (const [pi, period] of teaching.entries()) {
          const subject = subjects[(si + day + pi) % subjects.length]!;
          // A teacher who actually teaches that subject, and a different one per
          // slot so no human is in two rooms at once.
          const teacher = teachers[(si * 3 + day * 2 + pi) % teachers.length]!;
          slots.push({
            schoolId, classSectionId: sec.id, dayOfWeek: day, periodId: period.id,
            subjectId: subject.id, teacherId: teacher.id, academicYearId: year.id,
          });
        }
      }
    }
    await db.timetableSlot.createMany({ data: slots as never, skipDuplicates: true });
  });
  console.log('  ✓ a five-day timetable for every section');

  // ── Attendance ─────────────────────────────────────────────────────────────
  // With absences in it. An attendance screen where everybody is present shows
  // none of the things the screen exists to surface.
  const marker = await step((db) => db.user.findFirst({ where: { schoolId, role: 'SCHOOL_ADMIN' }, select: { id: true } }));
  for (let back = 1; back <= 8; back += 1) {
    const date = daysAgo(back);
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
    await step(async (db) => {
      const already = await db.attendance.count({ where: { schoolId, date } });
      if (already > 0) return;
      await db.attendance.createMany({
        data: roll.map((s) => {
          const r = rnd();
          return {
            schoolId, studentId: s.id, classSectionId: s.sectionId, date,
            markedById: marker!.id,
            status: r > 0.94 ? 'ABSENT' : r > 0.90 ? 'LATE' : 'PRESENT',
          };
        }) as never,
        skipDuplicates: true,
      });
    });
  }
  console.log('  ✓ attendance for the last working week, absences included');

  // ── Exams and marks ────────────────────────────────────────────────────────
  for (const sec of sections.slice(0, 12)) {
    for (const sub of subjects.slice(0, 4)) {
      const exam = await step(async (db) => {
        const found = await db.exam.findFirst({
          where: { schoolId, classSectionId: sec.id, subjectId: sub.id, title: 'Unit Test I' },
        });
        return found ?? db.exam.create({
          data: {
            schoolId, classSectionId: sec.id, subjectId: sub.id,
            title: 'Unit Test I', scheduledAt: daysAgo(between(10, 20)),
            maxMarks: 50, createdById: marker!.id,
          },
        });
      });
      await step(async (db) => {
        const already = await db.result.count({ where: { schoolId, examId: exam.id } });
        if (already > 0) return;
        const kids = roll.filter((s) => s.sectionId === sec.id);
        await db.result.createMany({
          data: kids.map((s) => ({
            schoolId, examId: exam.id, studentId: s.id,
            // A spread, not a bell curve around full marks: a results screen
            // where everybody scored 48/50 cannot show a struggling child.
            marks: Math.max(9, Math.min(50, Math.round(28 + (rnd() - 0.4) * 34))),
          })) as never,
          skipDuplicates: true,
        });
      });
    }
  }
  console.log('  ✓ Unit Test I marked for 12 sections across 4 subjects');

  // ── The daily traffic of a school ──────────────────────────────────────────
  for (const [i, sec] of sections.slice(0, 8).entries()) {
    const t = teachers[i % teachers.length]!;
    const sub = subjects[i % subjects.length]!;
    await step(async (db) => {
      const has = await db.assignment.count({ where: { schoolId, classSectionId: sec.id } });
      if (has > 0) return;
      await db.assignment.create({
        data: {
          schoolId, classSectionId: sec.id, subjectId: sub.id,
          title: `${sub.name}: worksheet ${i + 1}`,
          instructions: 'Complete the exercises on pages 44 to 46. Bring the notebook on Thursday.',
          dueDate: daysAhead(between(2, 9)), createdByTeacherId: t.id,
        },
      });
      await db.classNote.create({
        data: {
          schoolId, classSectionId: sec.id, subjectId: sub.id, date: daysAgo(1),
          body: 'Covered long division with remainders. Children who were away should see me at break.',
          authorTeacherId: t.id,
        },
      });
      await db.classTodo.create({
        data: {
          schoolId, classSectionId: sec.id, subjectId: sub.id, date: daysAhead(1),
          body: 'Bring a ruler and a sharpened pencil.', authorTeacherId: t.id,
        },
      });
      await db.diaryEntry.create({
        data: {
          schoolId, classSectionId: sec.id, date: daysAgo(2),
          body: 'Parent–teacher meeting on Saturday, 10am to 1pm. Please book a slot with the office.',
          authorTeacherId: t.id, kind: 'REMARK', audience: 'ALL',
        },
      });
    });
  }

  for (const [title, body] of [
    ['Half-term break', 'The school will be closed from the 12th to the 16th. Buses do not run.'],
    ['Annual day rehearsals', 'Classes VI to X finish at 12:50 all next week for rehearsals.'],
    ['New library hours', 'The library is now open until 5pm on weekdays.'],
    ['Fee schedule for 2027-28', 'Published on the website. No increase for continuing families.'],
  ] as const) {
    await step(async (db) => {
      const has = await db.announcement.findFirst({ where: { schoolId, title } });
      if (!has) await db.announcement.create({ data: { schoolId, title, body } });
    });
  }

  for (const [name, type, date] of [
    ['Ganesh Chaturthi', 'FESTIVAL', daysAhead(12)],
    ['Gandhi Jayanti', 'NATIONAL', daysAhead(36)],
    ['Diwali break', 'FESTIVAL', daysAhead(58)],
  ] as const) {
    await step(async (db) => {
      const has = await db.holiday.findFirst({ where: { schoolId, name } });
      if (!has) await db.holiday.create({ data: { schoolId, name, type, startDate: date } });
    });
  }

  for (const [title, when] of [
    ['Annual Day 2026', daysAhead(40)],
    ['Inter-house athletics', daysAhead(18)],
    ['Science exhibition', daysAhead(26)],
  ] as const) {
    await step(async (db) => {
      const has = await db.event.findFirst({ where: { schoolId, title } });
      if (has) return;
      const ev = await db.event.create({
        data: {
          schoolId, title, startAt: when,
          description: 'Open to parents and to alumni. Seating is limited, so please register.',
          venue: 'School auditorium', status: 'APPROVED',
        },
      });
      await db.eventTicketType.create({
        data: { schoolId, eventId: ev.id, name: 'Family (two adults)', priceMinor: 0, capacity: 200 },
      });
    });
  }

  for (const [parentName, phone, note] of [
    ['Sneha Kulkarni', '+919812300011', 'Looking for Class III from next April. Moving from Bengaluru.'],
    ['Imran Shaikh', '+919812300022', 'Twins, Nursery. Would like to visit on a working day.'],
    ['Rohit Deshmukh', '+919812300033', 'Class VIII, transferring from CBSE in Nashik.'],
  ] as const) {
    await step(async (db) => {
      const has = await db.enquiry.findFirst({ where: { schoolId, phone } });
      if (!has) await db.enquiry.create({ data: { schoolId, parentName, phone, message: note } });
    });
  }
  console.log('  ✓ homework, notes, diary, notices, holidays, 3 events, 3 enquiries');

  // ── Exam hall ──────────────────────────────────────────────────────────────
  for (const [name, rows, cols] of [['Main Hall', 10, 8], ['Annexe', 6, 6]] as const) {
    await step(async (db) => {
      const has = await db.room.findFirst({ where: { schoolId, name } });
      if (!has) await db.room.create({ data: { schoolId, name, rows, cols } });
    });
  }

  // ── Library ────────────────────────────────────────────────────────────────
  const BOOKS: [string, string, number][] = [
    ['Malgudi Days', 'R. K. Narayan', 4], ['The Blue Umbrella', 'Ruskin Bond', 5],
    ['Wings of Fire', 'A. P. J. Abdul Kalam', 3], ['Panchatantra', 'Vishnu Sharma', 6],
    ['A Brief History of Time', 'Stephen Hawking', 2], ['Matilda', 'Roald Dahl', 5],
    ['The Jungle Book', 'Rudyard Kipling', 4], ['Train to Pakistan', 'Khushwant Singh', 2],
    ['Harry Potter and the Philosopher’s Stone', 'J. K. Rowling', 6],
    ['The Diary of a Young Girl', 'Anne Frank', 3],
  ];
  await step(async (db) => {
    await db.librarySettings.upsert({ where: { schoolId }, update: {}, create: { schoolId } });
  });
  let accession = 1001;
  const copies: string[] = [];
  for (const [title, author, n] of BOOKS) {
    await step(async (db) => {
      let bt = await db.libraryBookTitle.findFirst({ where: { schoolId, title } });
      if (!bt) bt = await db.libraryBookTitle.create({ data: { schoolId, title, author } });
      for (let i = 0; i < n; i += 1) {
        const accessionNo = `A${accession++}`;
        const has = await db.libraryBookCopy.findFirst({ where: { schoolId, accessionNo } });
        if (!has) {
          const c = await db.libraryBookCopy.create({ data: { schoolId, titleId: bt.id, accessionNo } });
          copies.push(c.id);
        }
      }
    });
  }
  // Some out, some overdue — an issues screen with nothing overdue shows none of
  // the states the librarian is actually looking for.
  const librarian = await step((db) => db.staff.findFirst({ where: { schoolId, role: 'LIBRARIAN' }, select: { userId: true } }));
  for (const [i, copyId] of copies.slice(0, 14).entries()) {
    await step(async (db) => {
      const has = await db.libraryIssue.findFirst({ where: { schoolId, copyId, returnedOn: null } });
      if (has) return;
      const overdue = i < 4;
      await db.libraryIssue.create({
        data: {
          schoolId, copyId,
          studentId: roll[between(0, roll.length - 1)]!.id,
          issuedOn: daysAgo(overdue ? 30 : 6),
          dueOn: overdue ? daysAgo(9) : daysAhead(8),
          issuedById: librarian?.userId ?? marker!.id,
        },
      });
    });
  }
  console.log(`  ✓ library: ${BOOKS.length} titles, ${copies.length} copies, 14 out (4 overdue)`);

  // ── Hiring ─────────────────────────────────────────────────────────────────
  for (const [title, summary] of [
    ['Mathematics teacher, Classes VIII–X', 'CBSE, full time, from April 2027.'],
    ['Librarian', 'Part time, four days a week.'],
  ] as const) {
    await step(async (db) => {
      const has = await db.jobPost.findFirst({ where: { schoolId, title } });
      if (has) return;
      const job = await db.jobPost.create({
        data: {
          schoolId, title, summary,
          description: 'Two sections a year and a class you will know by name. Send us a note about how you teach.',
          status: 'APPROVED',
        },
      });
      await db.jobQuestion.create({
        data: {
          schoolId, jobPostId: job.id,
          prompt: 'Tell us about a lesson that did not work, and what you changed.',
          order: 0,
        },
      });
    });
  }
  console.log('  ✓ 2 open posts');

  console.log('\n──────────────────────────────────────────────');
  console.log(`  ${NAME}`);
  console.log(`    site    https://${HOST}`);
  console.log(`    admin   admin@${SLUG}.test / ${PW}`);
  console.log(`    teacher teacher1@${SLUG}.test / ${PW}`);
  console.log('  Run seed-alumni-demo.ts with DEMO_SCHOOL_SLUG=' + SLUG + ' for the alumni wing.');
  console.log('──────────────────────────────────────────────');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => disconnectAll());
