import { randomUUID } from 'node:crypto';
import type { Prisma } from '@skoolos/db';
import { Ctx, SectionInfo, StaffInfo, StudentInfo, TeacherInfo, many } from './ctx';
import {
  AREAS, CITY, FIRST_F, FIRST_M, GRADES, HOLIDAYS, HOUSES, MOTHER_FIRST, PERIODS, ROOMS, SCHOOL, STAFF,
  SUBJECTS, SURNAMES, weekly,
} from './data';
import { D, addDays, clamp, hashOf, iso, mobile } from './rng';

const FATHER_FIRST = [
  'Rakesh', 'Sanjay', 'Anil', 'Vijay', 'Manoj', 'Suresh', 'Rajesh', 'Amit', 'Deepak', 'Pankaj', 'Mahesh', 'Naveen',
  'Rohit', 'Vikas', 'Ashok', 'Dinesh', 'Harish', 'Mukesh', 'Ramesh', 'Sunil', 'Arun', 'Pramod', 'Sachin', 'Ajay', 'Kapil',
];

/** The school row, the year, and everything that is not a person. */
export async function structure(c: Ctx): Promise<void> {
  const { p, schoolId } = c;

  const year = await p.academicYear.create({
    data: { schoolId, name: SCHOOL.year, startDate: D(SCHOOL.yearStart), endDate: D(SCHOOL.yearEnd), isCurrent: true },
  });
  c.yearId = year.id;

  await p.subject.createMany({ data: SUBJECTS.map(([code, name]) => ({ schoolId, code, name })) });
  for (const s of await p.subject.findMany({ where: { schoolId } })) {
    c.subjectId.set(s.code, s.id);
    c.subjectName.set(s.code, s.name);
  }

  await p.period.createMany({
    data: PERIODS.map(([label, startTime, endTime, kind], i) => ({ schoolId, order: i + 1, label, startTime, endTime, kind })),
  });

  await p.grade.createMany({ data: GRADES.map((name, order) => ({ schoolId, name, order })) });
  const grades = await p.grade.findMany({ where: { schoolId }, orderBy: { order: 'asc' } });
  c.gradeId = grades.map((g) => g.id);

  await p.house.createMany({ data: HOUSES.map((h, order) => ({ schoolId, name: h.name, color: h.color, order })) });
  c.houseIds = (await p.house.findMany({ where: { schoolId }, orderBy: { order: 'asc' } })).map((h) => h.id);

  await p.holiday.createMany({
    data: HOLIDAYS.map(([name, type, from, to]) => ({ schoolId, name, type, startDate: D(from), endDate: to ? D(to) : null })),
  });
  for (const [, , from, to] of HOLIDAYS) {
    const end = to ? D(to) : D(from);
    for (let d = D(from); d <= end; d = addDays(d, 1)) c.holidays.add(iso(d));
  }

  await p.room.createMany({ data: ROOMS.map((name) => ({ schoolId, name, rows: 5, cols: 6, seatsPerDesk: 2 })) });

  // The teaching days of the attendance window: not a Sunday, not a holiday.
  for (let d = D(SCHOOL.attFrom); d <= D(SCHOOL.attTo); d = addDays(d, 1)) {
    if (d.getUTCDay() === 0 || c.holidays.has(iso(d))) continue;
    c.schoolDays.push(iso(d));
  }
}

const emailOf = (first: string, last: string) =>
  `${first.toLowerCase()}.${last.toLowerCase()}@${SCHOOL.emailDomain}`;
const emailsTaken = new Set<string>();

/** 20 teachers and 9 other staff, every one with a login whose password is "password". */
export async function staffAndTeachers(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  const users: Prisma.UserCreateManyInput[] = [];
  const teachers: Prisma.TeacherCreateManyInput[] = [];
  const links: Prisma.TeacherSubjectCreateManyInput[] = [];

  c.staffing.teachers.forEach((t, i) => {
    const id = randomUUID();
    const userId = randomUUID();
    let email = emailOf(t.first, t.last);
    for (let n = 2; emailsTaken.has(email); n += 1) email = `${t.first.toLowerCase()}.${t.last.toLowerCase()}${n}@${SCHOOL.emailDomain}`;
    emailsTaken.add(email);
    const name = `${t.first} ${t.last}`;
    const phone = mobile(r);
    users.push({ id: userId, schoolId, email, passwordHash: c.pwHash, role: 'TEACHER', name, phone, phoneVerifiedAt: D('2026-04-01') });
    teachers.push({
      id, schoolId, userId, firstName: t.first, lastName: t.last, email, phone, phoneE164: phone,
      gender: t.gender, dob: D(`${2026 - 25 - Math.min(t.years, 28)}-0${r.int(1, 9)}-${10 + r.int(0, 17)}`),
      employeeCode: `${SCHOOL.codePrefix}-T${String(i + 1).padStart(3, '0')}`,
      designation: t.designation, department: t.subjects[0] === 'PE' ? 'Sports' : t.subjects[0] === 'ART' ? 'Arts' : 'Academics',
      employmentType: 'Permanent', joinedOn: D(t.joined), highestQualification: t.qualification,
      experienceYears: t.years, primarySubjectId: c.subjectId.get(t.subjects[0]!)!,
      addressLine1: `${r.int(2, 120)}, ${r.pick(AREAS)}`, city: CITY.name, region: CITY.state, postalCode: CITY.pin,
      emergencyContactName: `${r.pick(FATHER_FIRST)} ${t.last}`, emergencyContactPhone: mobile(r), emergencyContactRelation: t.gender === 'F' ? 'Husband' : 'Wife',
      status: 'ACTIVE', isActive: true,
    });
    for (const code of t.subjects) links.push({ schoolId, teacherId: id, subjectId: c.subjectId.get(code)! });
    c.teachers.push({
      id, userId, email, name, subjects: t.subjects, grossRupees: t.grossRupees, joined: t.joined, designation: t.designation,
    });
  });

  const staff: Prisma.StaffCreateManyInput[] = [];
  STAFF.forEach((s) => {
    const id = randomUUID();
    const userId = randomUUID();
    let email = emailOf(s.first, s.last);
    for (let n = 2; emailsTaken.has(email); n += 1) email = `${s.first.toLowerCase()}.${s.last.toLowerCase()}${n}@${SCHOOL.emailDomain}`;
    emailsTaken.add(email);
    const phone = mobile(r);
    users.push({ id: userId, schoolId, email, passwordHash: c.pwHash, role: 'STAFF', name: `${s.first} ${s.last}`, phone });
    staff.push({ id, schoolId, firstName: s.first, lastName: s.last, role: s.role, email, phone, phoneE164: phone, userId, status: 'ACTIVE', isActive: true });
    c.staff.push({ id, userId, email, name: `${s.first} ${s.last}`, role: s.role, grossRupees: s.grossRupees });
  });
  c.officeUserId = c.staff.find((s) => s.role === 'OFFICE')!.userId;
  c.accountsUserId = c.staff.find((s) => s.role === 'ACCOUNTS')!.userId;
  c.librarianUserId = c.staff.find((s) => s.role === 'LIBRARIAN')!.userId;

  await many(c, 'User (staff)', users, (b) => p.user.createMany({ data: b }));
  await many(c, 'Teacher', teachers, (b) => p.teacher.createMany({ data: b }));
  await many(c, 'TeacherSubject', links, (b) => p.teacherSubject.createMany({ data: b }));
  await many(c, 'Staff', staff, (b) => p.staff.createMany({ data: b }));
}

/**
 * 45 sections; a class teacher for each; the subject teacher of every (section,
 * subject); and the whole week's timetable — 1,890 lessons, laid out by
 * staffing.ts so that no teacher is ever in two rooms at once.
 */
export async function sections(c: Ctx): Promise<void> {
  const { p, schoolId } = c;
  const plan = c.staffing;

  // A class teacher is someone who actually teaches that class a lot, and runs only one class.
  const ctOf: number[] = [];
  const isClassTeacher = new Set<number>();
  plan.sections.forEach((_, i) => {
    const mine = plan.lessons.filter((l) => l.section === i).sort((a, b) => b.count - a.count);
    const pick = mine.find((l) => !isClassTeacher.has(l.teacher) && !['PE', 'ART'].includes(l.subject))
      ?? mine.find((l) => !isClassTeacher.has(l.teacher)) ?? mine[0]!;
    isClassTeacher.add(pick.teacher);
    ctOf.push(pick.teacher);
  });

  const rows: Prisma.ClassSectionCreateManyInput[] = [];
  const assigns: Prisma.ClassTeacherAssignmentCreateManyInput[] = [];
  plan.sections.forEach((sec, i) => {
    const id = randomUUID();
    const ct = c.teachers[ctOf[i]!]!;
    rows.push({ id, schoolId, gradeId: c.gradeId[sec.g]!, name: sec.letter, classTeacherId: ct.id, academicYearId: c.yearId });
    assigns.push({ schoolId, classSectionId: id, teacherId: ct.id, fromAt: D(SCHOOL.yearStart) });
    c.sections.push({ id, gradeIdx: sec.g, grade: GRADES[sec.g]!, letter: sec.letter, label: sec.label, classTeacher: ct, subjects: Object.keys(weekly(sec.g, sec.letter)) });
  });
  await many(c, 'ClassSection', rows, (b) => p.classSection.createMany({ data: b }));
  await many(c, 'ClassTeacherAssignment', assigns, (b) => p.classTeacherAssignment.createMany({ data: b }));

  for (const l of plan.lessons) c.teacherFor.set(`${c.sections[l.section]!.id}|${l.subject}`, c.teachers[l.teacher]!);

  const periods = (await p.period.findMany({ where: { schoolId, kind: 'CLASS' }, orderBy: { order: 'asc' } })).map((x) => x.id);
  const slots: Prisma.TimetableSlotCreateManyInput[] = plan.slots.map((s) => ({
    schoolId, classSectionId: c.sections[s.section]!.id, dayOfWeek: s.day, periodId: periods[s.period]!,
    subjectId: c.subjectId.get(s.subject)!, teacherId: c.teachers[s.teacher]!.id, academicYearId: c.yearId,
    effectiveFrom: D(SCHOOL.yearStart),
  }));
  await many(c, 'TimetableSlot', slots, (b) => p.timetableSlot.createMany({ data: b }));
}

/** A section's size comes from its OWN label, never from the draw order. */
const sizeFor = (label: string, pre: boolean) => (pre ? 20 + (hashOf(label) % 5) : 24 + (hashOf(label) % 5));

/** The roll: ~1,150 children, numbered SPS-00001 upward in grade → section → name order. */
export async function roll(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  type Draft = {
    id: string; userId: string; first: string; last: string; female: boolean; section: SectionInfo;
    father: string; mother: string; phone: string; area: string; absentRate: number; ability: number;
  };
  const drafts: Draft[] = [];
  for (const s of c.sections) {
    const size = sizeFor(s.label, s.gradeIdx <= 2);
    for (let i = 0; i < size; i += 1) {
      const female = r.chance(0.48);
      const first = r.pick(female ? FIRST_F : FIRST_M);
      const last = r.pick(SURNAMES);
      // Most children are punctual; a few are often away; a handful very often.
      const u = r.next();
      const absentRate = clamp(
        u < 0.6 ? r.normal(0.035, 0.015) : u < 0.88 ? r.normal(0.075, 0.03) : u < 0.98 ? r.normal(0.14, 0.05) : r.normal(0.27, 0.08),
        0.004, 0.4,
      );
      // Ability is its own thing, but a child who is often away does slightly worse.
      const ability = clamp(r.normal(0.68, 0.15) - (absentRate - 0.05) * 0.8, 0.22, 0.97);
      drafts.push({
        id: randomUUID(), userId: randomUUID(), first, last, female, section: s,
        father: r.pick(FATHER_FIRST), mother: r.pick(MOTHER_FIRST), phone: mobile(r),
        area: `${r.int(2, 140)}, ${r.pick(AREAS)}`, absentRate, ability,
      });
    }
  }

  // Sibling pairs: the younger child takes the older one's family details.
  const bySection = new Map<string, Draft[]>();
  for (const d of drafts) bySection.set(d.section.id, [...(bySection.get(d.section.id) ?? []), d]);
  const taken = new Set<string>();
  const siblings: { younger: Draft; elder: Draft }[] = [];
  const pool = drafts.filter((d) => d.section.gradeIdx >= 5);
  for (let tries = 0; siblings.length < 26 && tries < 400; tries += 1) {
    const elder = r.pick(pool);
    const youngerGrade = elder.section.gradeIdx - r.int(2, 5);
    const youngerPool = drafts.filter((d) => d.section.gradeIdx === youngerGrade);
    if (!youngerPool.length || taken.has(elder.id)) continue;
    const younger = r.pick(youngerPool);
    if (taken.has(younger.id)) continue;
    taken.add(elder.id); taken.add(younger.id);
    Object.assign(younger, { last: elder.last, father: elder.father, mother: elder.mother, phone: elder.phone, area: elder.area });
    siblings.push({ younger, elder });
  }

  // Numbering and roll numbers: ordered, gap-free.
  const ordered: Draft[] = [];
  for (const s of c.sections) {
    ordered.push(...(bySection.get(s.id) ?? []).sort((a, b) => a.first.localeCompare(b.first) || a.last.localeCompare(b.last)));
  }
  const students: Prisma.StudentCreateManyInput[] = [];
  const users: Prisma.UserCreateManyInput[] = [];
  const rollNo = new Map<string, number>();
  ordered.forEach((d, i) => {
    const code = `${SCHOOL.codePrefix}-${String(i + 1).padStart(5, '0')}`;
    const g = d.section.gradeIdx;
    const rn = (rollNo.get(d.section.id) ?? 0) + 1;
    rollNo.set(d.section.id, rn);
    const entry = r.chance(0.8) ? 0 : g;
    const category = ((x) => (x < 0.7 ? 'General' : x < 0.9 ? 'OBC' : x < 0.95 ? 'SC' : x < 0.98 ? 'ST' : 'EWS'))(r.next());
    const onBus = r.chance(0.38);
    const isRte = g >= 3 && g <= 10 && r.chance(0.022);
    const email = `${code.toLowerCase()}@students.${SCHOOL.emailDomain}`;
    const name = `${d.first} ${d.last}`;
    users.push({ id: d.userId, schoolId, email, passwordHash: c.pwHash, role: 'STUDENT', name });
    students.push({
      id: d.id, schoolId, admissionNo: code, code, firstName: d.first, lastName: d.last,
      classSectionId: d.section.id, rollNo: String(rn), gender: d.female ? 'F' : 'M',
      dob: D(`${2026 - 3 - g}-${String(r.int(1, 12)).padStart(2, '0')}-${String(r.int(1, 28)).padStart(2, '0')}`),
      guardianName: `${d.father} ${d.last}`, guardianPhone: d.phone, guardianPhoneE164: d.phone,
      fatherName: `${d.father} ${d.last}`, motherName: `${d.mother} ${d.last}`,
      nationality: 'Indian', category, firstAdmissionDate: D(`${2026 - (g - entry)}-04-${String(r.int(1, 20)).padStart(2, '0')}`),
      firstAdmissionClass: GRADES[entry]!, userId: d.userId, isActive: true, status: 'ACTIVE',
      houseId: c.houseIds[i % c.houseIds.length], createdAt: D('2026-03-20'),
    });
    c.students.push({
      id: d.id, userId: d.userId, code, name, first: d.first, last: d.last, sectionId: d.section.id, gradeIdx: g,
      guardian: `${d.father} ${d.last}`, phone: d.phone, absentRate: d.absentRate, ability: d.ability, onBus, isRte,
    });
  });

  await many(c, 'User (students)', users, (b) => p.user.createMany({ data: b }));
  await many(c, 'Student', students, (b) => p.student.createMany({ data: b }));
  (c as unknown as { siblings: { younger: string; elder: string }[] }).siblings = siblings.map((s) => ({
    younger: s.younger.id, elder: s.elder.id,
  }));
}
