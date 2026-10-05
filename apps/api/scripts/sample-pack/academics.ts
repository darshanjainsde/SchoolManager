import { randomUUID } from 'node:crypto';
import type { Prisma } from '@skoolos/db';
import { Ctx, SectionInfo, many } from './ctx';
import { ANNOUNCEMENTS, CLASS_NOTES, HOMEWORK, REMARKS_CONCERN, REMARKS_POSITIVE, REPORT_REMARKS, SCHOOL } from './data';
import { D, addDays, clamp, iso, mobile } from './rng';

interface ExamSet {
  title: string; dates: string[]; from: number; published: string | null; offset: number; syllabus: string;
  max: (g: number) => number;
}
const SETS: ExamSet[] = [
  { title: 'Unit Test 1', dates: ['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04'], from: 3, published: '2026-07-10', offset: 0.04, syllabus: 'Chapters 1 to 3', max: (g) => (g >= 13 ? 40 : 25) },
  { title: 'Half-Yearly Examination', dates: ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21', '2026-09-22'], from: 0, published: '2026-09-25', offset: -0.03, syllabus: 'Complete syllabus up to September', max: (g) => (g <= 2 ? 50 : g >= 13 ? 70 : 80) },
  { title: 'Unit Test 2', dates: ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'], from: 3, published: null, offset: 0, syllabus: 'Chapters 9 to 12', max: (g) => (g >= 13 ? 40 : 25) },
];

const fill = (t: string, r: Ctx['r']) => t.replace('{n}', String(r.int(2, 9))).replace('{m}', String(r.int(1, 4)));

/**
 * Three exam rounds — two behind us with every mark in, one still ahead — and
 * a report-card remark for every child once the Half-Yearly is out.
 */
export async function exams(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  const examRows: Prisma.ExamCreateManyInput[] = [];
  const resultRows: Prisma.ResultCreateManyInput[] = [];
  const byId = new Map(c.students.map((s) => [s.id, s]));
  const roster = new Map<string, string[]>();
  for (const s of c.students) roster.set(s.sectionId, [...(roster.get(s.sectionId) ?? []), s.id]);
  const hy = new Map<string, { got: number; of: number }>();

  for (const set of SETS) {
    for (const sec of c.sections) {
      if (sec.gradeIdx < set.from) continue;
      const max = set.max(sec.gradeIdx);
      sec.subjects.forEach((code, idx) => {
        const teacher = c.teacherFor.get(`${sec.id}|${code}`)!;
        const when = new Date(`${set.dates[idx % set.dates.length]}T03:30:00.000Z`);
        const id = randomUUID();
        examRows.push({
          id, schoolId, classSectionId: sec.id, subjectId: c.subjectId.get(code)!, title: set.title,
          scheduledAt: when, syllabus: set.syllabus, maxMarks: max, createdById: teacher.userId,
          createdAt: addDays(when, -14),
        });
        if (!set.published) return;
        for (const sid of roster.get(sec.id) ?? []) {
          const stu = byId.get(sid)!;
          if (r.chance(0.012)) {
            resultRows.push({ schoolId, examId: id, studentId: sid, marks: 0, status: 'ABSENT', publishedAt: new Date(`${set.published}T06:00:00.000Z`) });
            continue;
          }
          const affinity = r.normal(0, 0.07);
          const pct = clamp(stu.ability + affinity + set.offset + r.normal(0, 0.04), 0.12, 1);
          const marks = Math.min(max, Math.round(pct * max * 2) / 2);
          resultRows.push({ schoolId, examId: id, studentId: sid, marks, status: 'PRESENT', publishedAt: new Date(`${set.published}T06:00:00.000Z`) });
          if (set.title.startsWith('Half')) {
            const t = hy.get(sid) ?? { got: 0, of: 0 };
            hy.set(sid, { got: t.got + marks, of: t.of + max });
          }
        }
      });
    }
  }
  await many(c, 'Exam', examRows, (b) => p.exam.createMany({ data: b }));
  await many(c, 'Result', resultRows, (b) => p.result.createMany({ data: b }), 5000);
  for (const [sid, t] of hy) c.halfYearly.set(sid, Math.round((t.got / t.of) * 100));

  // Report-card remarks, written by the class teacher once the results are in.
  const window = await p.reportWindow.create({
    data: {
      schoolId, academicYearId: c.yearId, name: 'Half-Yearly Examination 2026-27',
      startDate: D('2026-09-23'), endDate: D('2026-10-08'), resultDay: D('2026-09-26'),
    },
  });
  c.counts.ReportWindow = 1;
  const secById = new Map(c.sections.map((s) => [s.id, s]));
  const remarks: Prisma.ReportRemarkCreateManyInput[] = [];
  for (const stu of c.students) {
    const pct = c.halfYearly.get(stu.id) ?? 60;
    const band = REPORT_REMARKS.find((b) => pct >= b.min)!;
    remarks.push({
      schoolId, windowId: window.id, studentId: stu.id,
      text: r.pick(band.texts).replace('{n}', stu.first),
      authorId: secById.get(stu.sectionId)!.classTeacher.userId,
      createdAt: new Date(`2026-09-${r.int(24, 26)}T10:00:00.000Z`),
    });
  }
  await many(c, 'ReportRemark', remarks, (b) => p.reportRemark.createMany({ data: b }));
}

/**
 * The classroom: homework with who has seen it, class notes and to-dos, the
 * last three weeks of the diary, and teachers' remarks that parents sign.
 */
export async function classroom(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  const roster = new Map<string, typeof c.students>();
  for (const s of c.students) roster.set(s.sectionId, [...(roster.get(s.sectionId) ?? []), s]);
  const asOf = SCHOOL.asOf;

  /* ── assignments, and who has opened them ─────────────────────────────── */
  const assignments: Prisma.AssignmentCreateManyInput[] = [];
  const seen: Prisma.AssignmentSeenCreateManyInput[] = [];
  for (const sec of c.sections) {
    for (const code of r.shuffle(sec.subjects).slice(0, 5)) {
      const teacher = c.teacherFor.get(`${sec.id}|${code}`)!;
      const due = addDays(D(asOf), r.int(-12, 9));
      const given = addDays(due, -r.int(3, 7));
      const id = randomUUID();
      assignments.push({
        id, schoolId, classSectionId: sec.id, subjectId: c.subjectId.get(code)!,
        title: `${c.subjectName.get(code)} — ${r.pick(['worksheet', 'practice set', 'project work', 'chapter exercise', 'revision sheet'])}`,
        instructions: fill(r.pick(HOMEWORK[code] ?? HOMEWORK.ENG!), r),
        dueDate: due, createdByTeacherId: teacher.id, createdAt: given,
      });
      const past = due <= D(asOf);
      for (const s of roster.get(sec.id) ?? []) {
        if (r.chance(past ? 0.82 : 0.45)) seen.push({ schoolId, assignmentId: id, studentId: s.id, seenAt: addDays(given, r.int(0, 2)) });
      }
    }
  }
  await many(c, 'Assignment', assignments, (b) => p.assignment.createMany({ data: b }));
  await many(c, 'AssignmentSeen', seen, (b) => p.assignmentSeen.createMany({ data: b }), 5000);

  /* ── class notes and to-dos ───────────────────────────────────────────── */
  const recent = c.schoolDays.slice(-14);
  const notes: Prisma.ClassNoteCreateManyInput[] = [];
  const todos: Prisma.ClassTodoCreateManyInput[] = [];
  for (const sec of c.sections) {
    for (const code of sec.subjects.slice(0, 4)) {
      const teacher = c.teacherFor.get(`${sec.id}|${code}`)!;
      for (let k = 0; k < 2; k += 1) {
        const d = r.pick(recent);
        notes.push({ schoolId, classSectionId: sec.id, subjectId: c.subjectId.get(code)!, date: D(d), body: r.pick(CLASS_NOTES), authorTeacherId: teacher.id, createdAt: new Date(`${d}T09:00:00.000Z`) });
      }
    }
    for (let k = 0; k < 3; k += 1) {
      const code = r.pick(sec.subjects);
      const teacher = c.teacherFor.get(`${sec.id}|${code}`)!;
      const d = r.pick(recent);
      todos.push({
        schoolId, classSectionId: sec.id, subjectId: c.subjectId.get(code)!, date: D(d),
        body: r.pick(['Return the corrected notebooks', 'Collect the signed progress sheets', 'Finish the pending chapter before the unit test', 'Update the practical file marks', 'Prepare the question paper for the next test']),
        done: r.chance(0.55), authorTeacherId: teacher.id, createdAt: new Date(`${d}T09:30:00.000Z`),
      });
    }
  }
  await many(c, 'ClassNote', notes, (b) => p.classNote.createMany({ data: b }));
  await many(c, 'ClassTodo', todos, (b) => p.classTodo.createMany({ data: b }));

  /* ── the diary: homework every day, remarks to individual families ────── */
  const days = c.schoolDays.slice(-16);
  const lastFive = new Set(days.slice(-5));
  const entries: Prisma.DiaryEntryCreateManyInput[] = [];
  const acks: Prisma.DiaryAckCreateManyInput[] = [];
  for (const sec of c.sections) {
    for (const d of days) {
      for (const code of r.shuffle(sec.subjects).slice(0, 2)) {
        const teacher = c.teacherFor.get(`${sec.id}|${code}`)!;
        const id = randomUUID();
        const at = new Date(`${d}T10:00:00.000Z`);
        entries.push({
          id, schoolId, classSectionId: sec.id, subjectId: c.subjectId.get(code)!, date: D(d), kind: 'ITEM', audience: 'ALL',
          body: `${c.subjectName.get(code)}: ${fill(r.pick(HOMEWORK[code] ?? HOMEWORK.ENG!), r)}`,
          authorTeacherId: teacher.id, createdAt: at,
        });
        if (!lastFive.has(d)) continue;
        for (const s of roster.get(sec.id) ?? []) {
          if (!r.chance(0.62)) continue;
          const signed = r.chance(0.7);
          acks.push({
            schoolId, entryId: id, studentId: s.id, seenAt: addDays(at, 0),
            signedAt: signed ? new Date(at.getTime() + r.int(1, 20) * 3_600_000) : null, signedName: signed ? s.guardian : null,
          });
        }
      }
    }
  }

  // Remarks: ~170 of them, about half praise and half a gentle concern.
  const recipients: Prisma.DiaryRecipientCreateManyInput[] = [];
  const remarkSpread = r.shuffle(c.students).slice(0, 170);
  for (const stu of remarkSpread) {
    const sec = c.sections.find((x) => x.id === stu.sectionId) as SectionInfo;
    const d = r.pick(c.schoolDays.slice(-20));
    const id = randomUUID();
    const positive = r.chance(stu.ability > 0.7 ? 0.8 : 0.35);
    const at = new Date(`${d}T11:00:00.000Z`);
    entries.push({
      id, schoolId, classSectionId: sec.id, subjectId: null, date: D(d), kind: 'REMARK', audience: 'SELECTED',
      body: r.pick(positive ? REMARKS_POSITIVE : REMARKS_CONCERN).replace('{n}', stu.first),
      authorTeacherId: sec.classTeacher.id, createdAt: at,
    });
    recipients.push({ schoolId, entryId: id, studentId: stu.id });
    if (r.chance(0.8)) {
      const signed = r.chance(0.75);
      acks.push({ schoolId, entryId: id, studentId: stu.id, seenAt: at, signedAt: signed ? addDays(at, 1) : null, signedName: signed ? stu.guardian : null });
    }
  }
  await many(c, 'DiaryEntry', entries, (b) => p.diaryEntry.createMany({ data: b }));
  await many(c, 'DiaryRecipient', recipients, (b) => p.diaryRecipient.createMany({ data: b }));
  await many(c, 'DiaryAck', acks, (b) => p.diaryAck.createMany({ data: b }), 5000);
}

/** Notices to everyone and to single classes, and the admission enquiries on the desk. */
export async function notices(c: Ctx, enquiries: readonly (readonly [string, string, string])[]): Promise<void> {
  const { p, r, schoolId } = c;
  const day = (n: number) => addDays(D(SCHOOL.asOf), -n);
  const rows: Prisma.AnnouncementCreateManyInput[] = ANNOUNCEMENTS.map(([title, body, ago]) => ({
    schoolId, title, body, createdByUserId: c.officeUserId, createdAt: day(ago),
  }));
  const classSpecific = [
    ['Picnic permission slips', 'Please return the signed permission slip for the class picnic by Friday.'],
    ['Pending homework', 'A few students have not submitted the pending notebooks. Kindly check and send them tomorrow.'],
    ['Class test on Monday', 'There will be a short class test on Monday. Please revise the last two chapters.'],
    ['Project submission', 'The term project is due next week. Please ensure it is complete and neatly presented.'],
    ['Library period', 'Every class will visit the library once a week from now. Students should bring their library cards.'],
  ];
  for (const sec of r.shuffle(c.sections).slice(0, 10)) {
    const [title, body] = r.pick(classSpecific);
    rows.push({ schoolId, classSectionId: sec.id, title: `${sec.label}: ${title}`, body: body!, createdByUserId: sec.classTeacher.userId, createdAt: day(r.int(1, 25)) });
  }
  await many(c, 'Announcement', rows, (b) => p.announcement.createMany({ data: b }));

  const statuses = ['NEW', 'NEW', 'CONTACTED', 'CONTACTED', 'VISITED', 'APPLIED', 'ENROLLED', 'CLOSED', 'LOST'] as const;
  const eq: Prisma.EnquiryCreateManyInput[] = enquiries.map(([parentName, gradeInterest, message], i) => {
    const status = statuses[i % statuses.length]!;
    const created = day(r.int(2, 85));
    return {
      schoolId, parentName, phone: mobile(r), gradeInterest, message, status, ownerUserId: c.officeUserId,
      email: r.chance(0.5) ? `${parentName.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@example.com` : null,
      followUpAt: ['NEW', 'CONTACTED', 'VISITED'].includes(status) ? addDays(D(SCHOOL.asOf), r.int(1, 12)) : null,
      lostReason: status === 'LOST' ? 'Chose a school closer to home' : null,
      createdAt: created,
    };
  });
  await many(c, 'Enquiry', eq, (b) => p.enquiry.createMany({ data: b }));
  void iso;
}
