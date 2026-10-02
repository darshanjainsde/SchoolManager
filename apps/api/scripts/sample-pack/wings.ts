import { randomUUID } from 'node:crypto';
import type { Prisma } from '@skoolos/db';
import { Ctx, StudentInfo, many } from './ctx';
import { AREAS, CITY, FIRST_F, FIRST_M, SCHOOL, SURNAMES } from './data';
import { D, addDays, iso, mobile } from './rng';

const AS_OF = D(SCHOOL.asOf);
const DAY = 86_400_000;
const at = (d: Date, hour = 10) => new Date(d.getTime() + hour * 3_600_000);

/**
 * When a teacher is on approved leave, every lesson they were due to give that
 * day needs covering — so for each such day the lessons are taken from the
 * timetable, and a free teacher is named for each (a few are left uncovered,
 * which is what a real school's week looks like).
 */
export async function substitutions(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  const plan = c.staffing;
  const teacherIdx = new Map(c.teachers.map((t, i) => [t.id, i]));
  const periods = (await p.period.findMany({ where: { schoolId, kind: 'CLASS' }, orderBy: { order: 'asc' } })).map((x) => x.id);
  const busy = new Set(plan.slots.map((s) => `${s.teacher}|${s.day}|${s.period}`));
  const rows: Prisma.SubstitutionCreateManyInput[] = [];
  const coverUsed = new Set<string>();

  for (const [personId, days] of c.leaveDays) {
    const ti = teacherIdx.get(personId);
    if (ti === undefined) continue; // a non-teaching member of staff
    for (const date of [...days].sort()) {
      const day = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
      for (const s of plan.slots.filter((x) => x.teacher === ti && x.day === day)) {
        const free = c.teachers
          .map((t, i) => ({ t, i }))
          .filter(({ t, i }) => i !== ti && !busy.has(`${i}|${day}|${s.period}`) && !c.leaveDays.get(t.id)?.has(date) && !coverUsed.has(`${i}|${date}|${s.period}`));
        // Prefer someone who teaches the same subject, then anyone free.
        const same = free.filter(({ t }) => t.subjects.includes(s.subject));
        const pool = same.length ? same : free;
        const cover = r.chance(0.94) && pool.length ? r.pick(pool) : null;
        if (cover) coverUsed.add(`${cover.i}|${date}|${s.period}`);
        rows.push({
          schoolId, classSectionId: c.sections[s.section]!.id, periodId: periods[s.period]!, date: D(date),
          originalTeacherId: personId, substituteTeacherId: cover?.t.id ?? null,
          reason: 'Teacher on approved leave', createdAt: at(addDays(D(date), -1), 12),
        });
      }
    }
  }
  await many(c, 'Substitution', rows, (b) => p.substitution.createMany({ data: b }));
}

const CONCERNS: Record<string, { title: string; body: string }[]> = {
  BUS: [
    { title: 'Bus arrives late in the morning', body: 'The bus on our route has been reaching the stop 15 to 20 minutes late for the past week. My child misses the assembly. Please look into it.' },
    { title: 'Overcrowded bus on route 3', body: 'There are more children than seats on the afternoon bus and some have to stand. Could another trip or a bigger bus be arranged?' },
  ],
  FEES: [
    { title: 'Fee receipt not received', body: 'I paid the Term 2 fee by UPI four days ago and the receipt has not come yet. The amount has left my account. Kindly check.' },
    { title: 'Request for fee instalments', body: 'We would like to pay the Term 2 fee in two instalments this time because of a medical expense at home. Please let us know if this is possible.' },
  ],
  TEACHING: [
    { title: 'Extra help in Mathematics', body: 'My child finds the new chapter difficult and is losing confidence. Could the teacher suggest some extra practice or a doubt-clearing time?' },
    { title: 'Too much homework this week', body: 'The homework this week is taking over three hours every evening. Please check whether the subjects are giving it all on the same days.' },
  ],
  SAFETY: [
    { title: 'Gate is open during lunch break', body: 'I saw the side gate open during the lunch break yesterday with no guard nearby. Please make sure it stays closed while the children are outside.' },
  ],
  CANTEEN: [
    { title: 'Canteen food is cold', body: 'My child says the lunch from the canteen is often served cold and the queue is very long. Could the timing of the break be looked at?' },
  ],
  FACILITIES: [
    { title: 'Water cooler on the second floor', body: 'The drinking water cooler on the second floor has not been working for a week and the children have to go downstairs.' },
    { title: 'Classroom fan is not working', body: 'One of the fans in our child’s classroom has stopped. It is getting very warm in the afternoon.' },
  ],
  OTHER: [
    { title: 'Request for a bonafide certificate', body: 'We need a bonafide certificate for a scholarship application. Please tell us the process and how long it takes.' },
  ],
};

/** The Complaint Box: families raising things with the office or the class teacher, at every stage. */
export async function concerns(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  const rows: Prisma.ConcernCreateManyInput[] = [];
  const comments: Prisma.ConcernCommentCreateManyInput[] = [];
  const secOf = new Map(c.sections.map((s) => [s.id, s]));
  const cats = Object.keys(CONCERNS);
  const picked = r.shuffle(c.students).slice(0, 34);
  picked.forEach((stu, i) => {
    const category = cats[i % cats.length]!;
    const tpl = r.pick(CONCERNS[category]!);
    const sec = secOf.get(stu.sectionId)!;
    const toTeacher = ['TEACHING', 'OTHER'].includes(category) ? true : r.chance(0.2);
    const status = ((x) => (x < 0.28 ? 'OPEN' : x < 0.55 ? 'IN_PROGRESS' : 'RESOLVED'))(r.next()) as 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
    const created = addDays(AS_OF, -r.int(1, 70));
    const handler = toTeacher ? sec.classTeacher.userId : c.officeUserId;
    const id = randomUUID();
    const touched = status === 'OPEN' ? created : addDays(created, r.int(1, 6));
    rows.push({
      id, schoolId, studentId: stu.id, raisedById: stu.userId, raisedByRole: 'STUDENT', audience: toTeacher ? 'CLASS_TEACHER' : 'OFFICE',
      assignedTeacherId: toTeacher ? sec.classTeacher.id : null, category, title: tpl.title, body: tpl.body, status,
      readByOfficeAt: !toTeacher && status !== 'OPEN' ? addDays(created, 1) : null,
      readByTeacherAt: toTeacher && status !== 'OPEN' ? addDays(created, 1) : null,
      resolvedAt: status === 'RESOLVED' ? touched : null, resolvedById: status === 'RESOLVED' ? handler : null,
      lastActivityAt: touched, createdAt: at(created, 11),
    });
    if (status !== 'OPEN') {
      comments.push({
        schoolId, concernId: id, authorId: handler, authorRole: toTeacher ? 'TEACHER' : 'OFFICE', visibleToFamily: true,
        body: status === 'RESOLVED'
          ? 'Thank you for letting us know. This has been looked into and sorted out. Please tell us if it comes up again.'
          : 'Thank you for writing. We have noted this and are looking into it; we will update you shortly.',
        statusFrom: 'OPEN', statusTo: status, createdAt: at(touched, 12),
      });
    }
    if (status === 'RESOLVED' && r.chance(0.5)) {
      comments.push({
        schoolId, concernId: id, authorId: stu.userId, authorRole: 'STUDENT', visibleToFamily: true,
        body: 'Thank you, it is fine now.', createdAt: at(addDays(touched, 1), 9),
      });
    }
  });
  await many(c, 'Concern', rows, (b) => p.concern.createMany({ data: b }));
  await many(c, 'ConcernComment', comments, (b) => p.concernComment.createMany({ data: b }));
}

/** Parent–teacher messages: one thread per child, teacher and subject, a few exchanges each. */
export async function messages(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  const threads: Prisma.MessageThreadCreateManyInput[] = [];
  const msgs: Prisma.MessageCreateManyInput[] = [];
  const secOf = new Map(c.sections.map((s) => [s.id, s]));
  const openers = [
    'Good morning ma’am. Could you please tell me how my child is doing in class?',
    'Sir, my child was absent yesterday because of fever. Kindly let us know the homework that was given.',
    'Could you share the syllabus for the upcoming unit test?',
    'My child is finding this chapter a little difficult. Is there any extra practice you can suggest?',
    'Thank you for the remark in the diary. We will make sure it is followed at home.',
  ];
  const replies = [
    'Good morning. Your child is doing well and is attentive in class. A little more practice at home will help.',
    'Hope the fever is better now. The homework is in the diary for that day; please have it completed by Monday.',
    'The unit test will cover the chapters taught so far. I have shared the list in the diary.',
    'Yes, I will give a short practice sheet on Monday. Please ask your child to attempt it and show me.',
    'Thank you for your support. Please feel free to message me anytime.',
  ];
  const used = new Set<string>();
  for (const stu of r.shuffle(c.students).slice(0, 80)) {
    const sec = secOf.get(stu.sectionId)!;
    const code = r.pick(sec.subjects);
    const teacher = c.teacherFor.get(`${sec.id}|${code}`)!;
    const key = `${stu.id}|${teacher.id}|${code}`;
    if (used.has(key)) continue;
    used.add(key);
    const id = randomUUID();
    let t = addDays(AS_OF, -r.int(2, 40));
    const k = r.int(0, replies.length - 1);
    const n = r.int(2, 5);
    for (let m = 0; m < n; m += 1) {
      t = new Date(t.getTime() + r.int(2, 20) * 3_600_000);
      const fromFamily = m % 2 === 0;
      msgs.push({
        schoolId, threadId: id, senderRole: fromFamily ? 'STUDENT' : 'TEACHER',
        body: fromFamily ? (m === 0 ? openers[k]! : 'Thank you, I will do that.') : replies[k]!,
        readAt: m === n - 1 && !fromFamily && r.chance(0.3) ? null : new Date(t.getTime() + 3_600_000), createdAt: t,
      });
    }
    threads.push({ id, schoolId, studentId: stu.id, teacherId: teacher.id, subjectId: c.subjectId.get(code)!, classSectionId: sec.id, lastMessageAt: t, createdAt: addDays(t, -1) });
  }
  await many(c, 'MessageThread', threads, (b) => p.messageThread.createMany({ data: b }));
  await many(c, 'Message', msgs, (b) => p.message.createMany({ data: b }));
}

/** The bell: what each person's phone would have shown them this term. */
export async function notifications(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  const rows: Prisma.NotificationCreateManyInput[] = [];
  const day = (n: number) => at(addDays(AS_OF, -n), r.int(8, 18));
  const students = r.shuffle(c.students);

  for (const stu of students.slice(0, 260)) {
    rows.push({ schoolId, userId: stu.userId, kind: 'ANNOUNCEMENT', title: 'Half-Yearly results and PTM', body: 'The Parent–Teacher Meeting is on 26 September. Please carry the diary.', readAt: r.chance(0.7) ? day(r.int(1, 5)) : null, createdAt: day(8) });
  }
  for (const stu of students.slice(0, 170)) {
    rows.push({ schoolId, userId: stu.userId, kind: 'REMARK', title: 'A new remark in the diary', body: 'Your class teacher has written a remark. Please read and sign it.', readAt: r.chance(0.6) ? day(r.int(0, 4)) : null, createdAt: day(r.int(1, 18)) });
  }
  const paid = await p.feePayment.findMany({ where: { schoolId, status: 'VERIFIED' }, orderBy: { paidOn: 'desc' }, take: 300, select: { studentId: true, amountMinor: true, paidOn: true } });
  const userOf = new Map(c.students.map((s) => [s.id, s.userId]));
  for (const x of paid) {
    const uid = userOf.get(x.studentId);
    if (uid) rows.push({ schoolId, userId: uid, kind: 'FEE_VERIFIED', title: 'Payment received', body: `We have received ₹${Math.round(x.amountMinor / 100).toLocaleString('en-IN')}. Your receipt is ready.`, readAt: r.chance(0.8) ? addDays(x.paidOn, 1) : null, createdAt: addDays(x.paidOn, 1) });
  }
  const decided = await p.leaveApplication.findMany({ where: { schoolId, teacherId: { not: null }, status: { in: ['APPROVED', 'REJECTED'] } }, select: { teacherId: true, status: true, startDate: true, reviewedAt: true } });
  const teacherUser = new Map(c.teachers.map((t) => [t.id, t.userId]));
  for (const l of decided) {
    const uid = teacherUser.get(l.teacherId!);
    if (uid) rows.push({ schoolId, userId: uid, kind: 'LEAVE_DECIDED', title: `Leave ${l.status === 'APPROVED' ? 'approved' : 'not approved'}`, body: `Your leave from ${iso(l.startDate)} was ${l.status === 'APPROVED' ? 'approved' : 'not approved'}.`, readAt: l.reviewedAt, createdAt: l.reviewedAt ?? l.startDate });
  }
  for (const t of c.teachers.slice(0, 30)) {
    rows.push({ schoolId, userId: t.userId, kind: 'ANNOUNCEMENT', title: 'Half-Yearly results are published', body: 'Marks of every class have been published. Please check the remarks for your class.', readAt: r.chance(0.8) ? day(7) : null, createdAt: day(8) });
  }
  await many(c, 'Notification', rows, (b) => p.notification.createMany({ data: b }), 3000);
}

/** The "your child's attendance has dropped" letters a class teacher sends, for children under 80%. */
export async function attendanceNotices(c: Ctx): Promise<void> {
  const { p, schoolId } = c;
  const low = await p.$queryRaw<{ studentId: string; classSectionId: string; pct: number }[]>`
    SELECT "studentId", min("classSectionId"::text)::uuid AS "classSectionId",
           round(100.0 * sum(("status" <> 'ABSENT')::int) / count(*))::int AS pct
      FROM "Attendance" WHERE "schoolId" = ${schoolId}::uuid
     GROUP BY "studentId" HAVING 100.0 * sum(("status" <> 'ABSENT')::int) / count(*) < 80
     ORDER BY pct LIMIT 60`;
  const secOf = new Map(c.sections.map((s) => [s.id, s]));
  const rows: Prisma.AttendanceNoticeCreateManyInput[] = low.map((x) => ({
    schoolId, studentId: x.studentId, classSectionId: x.classSectionId, percent: x.pct, threshold: 80,
    sentByTeacherId: secOf.get(x.classSectionId)!.classTeacher.id, sentAt: at(addDays(AS_OF, -3), 11),
  }));
  await many(c, 'AttendanceNotice', rows, (b) => p.attendanceNotice.createMany({ data: b }));
}

/** What the office wrote down while chasing each admission enquiry. */
export async function enquiryNotes(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  const office = c.staff.find((s) => s.role === 'OFFICE')!;
  const enq = await p.enquiry.findMany({ where: { schoolId }, orderBy: { createdAt: 'asc' } });
  const rows: Prisma.EnquiryNoteCreateManyInput[] = [];
  const stage: Record<string, string[]> = {
    CONTACTED: ['Called the parent; shared the fee structure and admission dates.'],
    VISITED: ['Called the parent; shared the fee structure.', 'Visited the school with the child; met the principal and saw the campus.'],
    APPLIED: ['Called the parent; shared the fee structure.', 'Visited the school.', 'Application form and documents received.'],
    ENROLLED: ['Called the parent; shared the fee structure.', 'Visited the school.', 'Admission fee paid; seat confirmed.'],
    CLOSED: ['Called the parent; no further interest at the moment.'],
    LOST: ['Called twice; the family has chosen a school closer to home.'],
  };
  for (const e of enq) {
    (stage[e.status] ?? []).forEach((body, i) => rows.push({
      schoolId, enquiryId: e.id, kind: i === 0 ? 'NOTE' : 'STAGE', body, authorUserId: office.userId, authorName: office.name,
      createdAt: addDays(e.createdAt, i * r.int(2, 6) + 1),
    }));
  }
  await many(c, 'EnquiryNote', rows, (b) => p.enquiryNote.createMany({ data: b }));
}

/** Income-tax declarations for the year, some filed, some still in draft. */
export async function taxDeclarations(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  const rows: Prisma.TaxDeclarationCreateManyInput[] = r.shuffle(c.teachers).slice(0, 16).map((t) => {
    const old = r.chance(0.4);
    const submitted = r.chance(0.65);
    return {
      schoolId, personKind: 'TEACHER', teacherId: t.id, taxYear: 2026, regime: old ? 'OLD' : 'NEW',
      rentAnnualMinor: old ? r.int(60, 180) * 1000 * 100 : 0, metro: false,
      section80cMinor: old ? r.int(80, 150) * 1000 * 100 : 0, section80dMinor: old ? r.int(10, 25) * 1000 * 100 : 0,
      homeLoanInterestMinor: old && r.chance(0.3) ? r.int(60, 200) * 1000 * 100 : 0,
      status: submitted ? 'SUBMITTED' : 'DRAFT', submittedAt: submitted ? at(addDays(AS_OF, -r.int(5, 60)), 11) : null,
    };
  });
  await many(c, 'TaxDeclaration', rows, (b) => p.taxDeclaration.createMany({ data: b }));
}

/** Class visits to the library: who was there, week by week. */
export async function libraryHall(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  const periods = (await p.period.findMany({ where: { schoolId, kind: 'CLASS' }, orderBy: { order: 'asc' } })).map((x) => x.id);
  const roster = new Map<string, StudentInfo[]>();
  for (const s of c.students) roster.set(s.sectionId, [...(roster.get(s.sectionId) ?? []), s]);
  const visits: Prisma.LibraryHallVisitCreateManyInput[] = [];
  const marks: Prisma.LibraryHallMarkCreateManyInput[] = [];
  const days = c.schoolDays.slice(-40);
  for (const sec of c.sections) {
    if (sec.gradeIdx < 1) continue;
    for (const date of r.shuffle(days).slice(0, 2)) {
      const id = randomUUID();
      visits.push({ id, schoolId, classSectionId: sec.id, date: D(date), periodId: r.pick(periods), source: r.chance(0.8) ? 'SYNCED' : 'RETAKEN', savedById: c.librarianUserId, createdAt: at(D(date), 6) });
      for (const stu of roster.get(sec.id) ?? []) marks.push({ schoolId, visitId: id, studentId: stu.id, status: r.chance(0.94) ? (r.chance(0.97) ? 'PRESENT' : 'LATE') : 'ABSENT' });
    }
  }
  await many(c, 'LibraryHallVisit', visits, (b) => p.libraryHallVisit.createMany({ data: b }));
  await many(c, 'LibraryHallMark', marks, (b) => p.libraryHallMark.createMany({ data: b }), 5000);
}

/** Vacancies the school has advertised, and the people who applied. */
export async function hiring(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  const posts = [
    { title: 'PGT Physics (Classes XI–XII)', subject: 'Physics', summary: 'Post-graduate teacher for the Science stream.', type: 'FULL_TIME' as const, posts: 1, min: 60000, max: 78000, status: 'APPROVED' as const, applyBy: addDays(AS_OF, 21) },
    { title: 'Primary Teacher (Classes I–V)', subject: 'All subjects', summary: 'Class teacher for a primary section.', type: 'FULL_TIME' as const, posts: 2, min: 26000, max: 38000, status: 'APPROVED' as const, applyBy: addDays(AS_OF, 14) },
    { title: 'School Bus Driver', subject: null, summary: 'Experienced heavy-vehicle driver for the morning and afternoon routes.', type: 'FULL_TIME' as const, posts: 1, min: 18000, max: 24000, status: 'CLOSED' as const, applyBy: addDays(AS_OF, -20) },
  ];
  const jobRows: Prisma.JobPostCreateManyInput[] = [];
  const qRows: Prisma.JobQuestionCreateManyInput[] = [];
  const aRows: Prisma.JobApplicationCreateManyInput[] = [];
  const names = [...FIRST_F.slice(0, 18), ...FIRST_M.slice(0, 18)];
  for (const [pi, j] of posts.entries()) {
    const id = randomUUID();
    jobRows.push({
      id, schoolId, title: j.title, summary: j.summary, subject: j.subject,
      description: `${j.summary} Candidates should hold the qualifications required for the post and be comfortable working in an English-medium, co-educational school. Applications close on ${iso(j.applyBy)}.`,
      employmentType: j.type, posts: j.posts, salaryMinMinor: j.min * 100, salaryMaxMinor: j.max * 100, applyBy: j.applyBy, status: j.status,
      createdByUserId: c.officeUserId, approvedByUserId: c.officeUserId, approvedAt: addDays(AS_OF, -45 + pi * 5), createdAt: addDays(AS_OF, -50 + pi * 5),
    });
    const q1 = randomUUID(); const q2 = randomUUID(); const q3 = randomUUID();
    qRows.push(
      { id: q1, jobPostId: id, schoolId, prompt: 'Years of teaching experience', kind: 'NUMBER', options: [], required: true, order: 0 },
      { id: q2, jobPostId: id, schoolId, prompt: 'Can you join within 30 days?', kind: 'YES_NO', options: [], required: true, order: 1 },
      { id: q3, jobPostId: id, schoolId, prompt: 'Highest qualification', kind: 'CHOICE', options: ['Graduate', 'Post-graduate', 'Post-graduate with B.Ed', 'Other'], required: false, order: 2 },
    );
    const n = pi === 0 ? 6 : pi === 1 ? 8 : 5;
    const status = ['NEW', 'NEW', 'SHORTLISTED', 'INTERVIEWING', 'REJECTED', 'HIRED'] as const;
    for (let k = 0; k < n; k += 1) {
      const first = r.pick(names); const last = r.pick(SURNAMES);
      aRows.push({
        jobPostId: id, schoolId, name: `${first} ${last}`, email: `${first}.${last}${r.int(1, 99)}@example.com`.toLowerCase(), phone: mobile(r),
        cvUrl: `https://example.com/sample-cv/${first}-${last}.pdf`.toLowerCase(),
        answers: { [q1]: r.int(1, 15), [q2]: r.chance(0.7), [q3]: r.pick(['Post-graduate', 'Post-graduate with B.Ed', 'Graduate']) },
        status: pi === 2 && k > 2 ? 'REJECTED' : status[k % status.length]!, createdAt: addDays(AS_OF, -r.int(2, 40)),
      });
    }
  }
  await many(c, 'JobPost', jobRows, (b) => p.jobPost.createMany({ data: b }));
  await many(c, 'JobQuestion', qRows, (b) => p.jobQuestion.createMany({ data: b }));
  await many(c, 'JobApplication', aRows, (b) => p.jobApplication.createMany({ data: b }));
}

const PROFESSIONS: [string, string][] = [
  ['Software Engineer', 'Infosys'], ['Doctor (MBBS)', 'Government Medical College'], ['Chartered Accountant', 'Own practice'], ['Army Officer', 'Indian Army'],
  ['Teacher', 'Government School'], ['Civil Engineer', 'L&T'], ['Bank Officer', 'State Bank of India'], ['Lawyer', 'Punjab & Haryana High Court'],
  ['Entrepreneur', 'Own business'], ['Pharmacist', 'Apollo Pharmacy'], ['Data Analyst', 'TCS'], ['Journalist', 'Dainik Bhaskar'], ['Farmer & Agri-business', 'Family farm'],
];
const COLLEGES = ['Kurukshetra University', 'Panjab University, Chandigarh', 'Delhi University', 'NIT Kurukshetra', 'Chitkara University', 'Amity University', 'IIT Delhi', 'Government College, Ladwa'];
const CITIES = ['Kurukshetra', 'Chandigarh', 'Delhi', 'Gurugram', 'Pune', 'Bengaluru', 'Ambala', 'Karnal', 'Patiala', 'Mumbai'];

/** Past students: the alumni roll by batch, a few of them mentors, and claims waiting to be checked. */
export async function alumni(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  const batches = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
  await many(c, 'AlumniBatch', batches.map((batchYear) => ({ schoolId, batchYear, registerStrength: r.int(68, 104), note: batchYear === 2025 ? 'The most recent batch' : null })), (b) => p.alumniBatch.createMany({ data: b }));
  const rows: Prisma.AlumniCreateManyInput[] = [];
  for (const year of batches) {
    for (let k = 0; k < 14; k += 1) {
      const female = r.chance(0.48);
      const first = r.pick(female ? FIRST_F : FIRST_M); const last = r.pick(SURNAMES);
      const [profession, employer] = r.pick(PROFESSIONS);
      const status = ((x) => (x < 0.45 ? 'VERIFIED' : x < 0.75 ? 'SCHOOL_ADDED' : x < 0.92 ? 'INVITED' : 'PENDING'))(r.next()) as 'VERIFIED' | 'SCHOOL_ADDED' | 'INVITED' | 'PENDING';
      rows.push({
        schoolId, firstName: first, lastName: last, batchYear: year, lastClass: 'XII', admissionNo: `${SCHOOL.codePrefix}-A${year}${String(k + 1).padStart(3, '0')}`,
        dob: D(`${year - 18}-${String(r.int(1, 12)).padStart(2, '0')}-${String(r.int(1, 28)).padStart(2, '0')}`),
        guardianName: `${r.pick(FIRST_M)} ${last}`, email: `${first}.${last}${year}@example.com`.toLowerCase(), phone: mobile(r),
        city: r.pick(CITIES), country: 'India', profession: year >= 2024 ? 'Studying' : profession, employer: year >= 2024 ? r.pick(COLLEGES) : employer,
        collegeName: r.pick(COLLEGES), status, isMentor: status === 'VERIFIED' && r.chance(0.2), isBatchCaptain: k === 0,
        verifiedAt: status === 'VERIFIED' ? addDays(AS_OF, -r.int(10, 200)) : null,
      });
    }
  }
  await many(c, 'Alumni', rows, (b) => p.alumni.createMany({ data: b }));
  const claims: Prisma.AlumniClaimCreateManyInput[] = [
    { schoolId, firstName: 'Sunita', lastName: 'Rao', batchYear: 2020, claimedClass: 'XII-B', email: 'sunita.rao.work@example.com', phone: mobile(r), proof: 'I was in the 2020 batch, Class XII-B. Our class teacher was Mrs. Sinha.', status: 'PENDING', createdAt: addDays(AS_OF, -6) },
    { schoolId, firstName: 'Rohit', lastName: 'Chauhan', batchYear: 2022, claimedClass: 'XII-A', email: 'rohit.c.2022@example.com', phone: mobile(r), proof: 'Science stream, 2022 batch. I was the sports captain.', status: 'PENDING', createdAt: addDays(AS_OF, -2) },
    { schoolId, firstName: 'Neha', lastName: 'Kapoor', batchYear: 2021, claimedClass: 'XII-C', email: 'neha.kapoor21@example.com', proof: 'Commerce, 2021. Can be vouched for by my classmates.', status: 'DECLINED', declineReason: 'We could not match the name and year with the register. Please write with your admission number.', reviewedAt: addDays(AS_OF, -12), createdAt: addDays(AS_OF, -15) },
  ];
  await many(c, 'AlumniClaim', claims, (b) => p.alumniClaim.createMany({ data: b }));
  void AREAS; void CITY;
}
