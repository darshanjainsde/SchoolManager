import { Injectable, Logger } from '@nestjs/common';
import { Prisma, withTenant, type TenantTx } from '@skoolos/db';
import { assertNotificationKind, assertNotificationOutboxKind, beatsRecord, formatMark, groupLabel, resolveSport, type MarkScoring } from '@skoolos/types';
import { AuditService } from '../../../common/audit/audit.service';
import { ApiError } from '../../../common/errors/api-error';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { MailService } from '../../../common/mail/mail.service';
import { runInBackground } from '../../../common/notifications/run-in-background';
import { activeStudentsWhere } from '../../../common/roster/active-students';
import { SportsSettingsService } from './sports-settings.service';
import type { AddRecordDto, DecideAttemptDto, SubmitAttemptDto } from './sports.dto';

export interface RecordLine { sportKey: string; sportName: string; groupKey: string; category: string; scoring: MarkScoring }
export interface RecordView {
  id: string; sportKey: string; sportName: string; groupKey: string; category: string; value: number; unit: string; text: string;
  holderName: string; holderStudentId: string | null; setOn: string | null; sinceYear: number; untilYear: number | null; status: string; source: string; note: string | null;
}

/** IST year — a record set at 23:30 on 31 Dec belongs to the year the school lived in. */
const istYear = () => new Date(Date.now() + 5.5 * 3_600_000).getUTCFullYear();
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * The Book of Records (spec §6). A line is sport × group × category. The
 * STANDING row is the current holder; BROKEN rows are history; VOID rows
 * were withdrawn with a note and never come back. Nothing becomes a record
 * on its own: a meet mark or a practice claim is an ATTEMPT that waits for a
 * VERIFY-holder or the admin, so a typo cannot rewrite the book.
 */
@Injectable()
export class SportsRecordsService {
  private readonly log = new Logger(SportsRecordsService.name);
  constructor(private readonly mail: MailService, private readonly audit: AuditService, private readonly settings: SportsSettingsService) {}

  list(schoolId: string): Promise<{ records: RecordView[]; pending: number }> {
    return withTenant(schoolId, async (tx) => {
      const [rows, pending] = await Promise.all([
        tx.sportsRecord.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, status: 'STANDING' }, orderBy: [{ sportKey: 'asc' }, { groupKey: 'asc' }, { category: 'asc' }] }),
        tx.sportsRecordAttempt.count({ where: { schoolId, status: 'PENDING' } }),
      ]);
      return { records: rows.map(view), pending };
    });
  }

  history(schoolId: string, sportKey: string, groupKey: string, category: string): Promise<RecordView[]> {
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.sportsRecord.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, sportKey, groupKey, category }, orderBy: [{ sinceYear: 'desc' }, { createdAt: 'desc' }] });
      return rows.map(view);
    });
  }

  attempts(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.sportsRecordAttempt.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, status: 'PENDING' }, orderBy: { createdAt: 'asc' } });
      const students = await tx.student.findMany({
        take: LIST_CEILING.ACTIVITY, where: { schoolId, id: { in: [...new Set(rows.map((r) => r.studentId))] } },
        select: { id: true, firstName: true, lastName: true, classSection: { select: { name: true, grade: { select: { name: true } } } } },
      });
      const byId = new Map(students.map((s) => [s.id, s]));
      return rows.map((r) => {
        const s = byId.get(r.studentId);
        const sport = resolveSport(r.sportKey, r.sportName);
        return {
          id: r.id, sportKey: r.sportKey, sportName: r.sportName, groupKey: r.groupKey, category: r.category, value: r.value, unit: r.unit,
          text: sport?.scoring.type === 'MARK' ? formatMark(sport.scoring, r.value) : String(r.value),
          source: r.source, witnessed: r.witnessed, createdAt: r.createdAt,
          student: s ? { id: s.id, name: `${s.firstName} ${s.lastName}`.trim(), classLabel: s.classSection ? `${s.classSection.grade.name} ${s.classSection.name}` : '' } : { id: r.studentId, name: 'Former student', classLabel: '' },
        };
      });
    });
  }

  /**
   * Called by the results desk inside its transaction for every mark that
   * beats the standing record (or where none stands). One pending attempt per
   * student × line × value — a heat re-saved twice does not queue twice.
   */
  async noteAttemptIfRecord(tx: TenantTx, schoolId: string, actorId: string, line: RecordLine, studentId: string, value: number, source: 'MEET'): Promise<boolean> {
    const standing = await tx.sportsRecord.findFirst({ where: { schoolId, sportKey: line.sportKey, groupKey: line.groupKey, category: line.category, status: 'STANDING' }, select: { value: true } });
    if (standing && !beatsRecord(line.scoring, value, standing.value)) return false;
    const dup = await tx.sportsRecordAttempt.findFirst({ where: { schoolId, studentId, sportKey: line.sportKey, groupKey: line.groupKey, category: line.category, value, status: 'PENDING' }, select: { id: true } });
    if (dup) return false;
    await tx.sportsRecordAttempt.create({
      data: { schoolId, sportKey: line.sportKey, sportName: line.sportName, groupKey: line.groupKey, category: line.category, studentId, value, unit: line.scoring.unit, source, witnessed: true, enteredById: actorId },
    });
    return true;
  }

  /** A claim from practice or a trial — waits for verification like a meet mark. */
  async submit(schoolId: string, actorId: string, dto: SubmitAttemptDto): Promise<{ id: string; beatsStanding: boolean }> {
    const sport = resolveSport(dto.sportKey);
    if (!sport || sport.scoring.type !== 'MARK') throw new ApiError('UNKNOWN_SPORT', 'Records are kept for measured and judged sports only.', 400, 'sportKey');
    const scoring = sport.scoring;
    return withTenant(schoolId, async (tx) => {
      const s = await tx.student.findFirst({ where: activeStudentsWhere(schoolId, { id: dto.studentId }), select: { id: true } });
      if (!s) throw new ApiError('VALIDATION', 'That student is not on the active roll.', 400, 'studentId');
      const standing = await tx.sportsRecord.findFirst({ where: { schoolId, sportKey: dto.sportKey, groupKey: dto.groupKey, category: dto.category, status: 'STANDING' }, select: { value: true } });
      const beatsStanding = !standing || beatsRecord(scoring, dto.value, standing.value);
      const row = await tx.sportsRecordAttempt.create({
        data: { schoolId, sportKey: sport.key, sportName: sport.name, groupKey: dto.groupKey, category: dto.category, studentId: dto.studentId, value: dto.value, unit: scoring.unit, source: dto.source, witnessed: dto.witnessed, enteredById: actorId },
        select: { id: true },
      });
      return { id: row.id, beatsStanding };
    });
  }

  /** Approve: the standing record becomes history and the attempt becomes the record; the child hears about it. Reject: closed with a note. */
  decide(schoolId: string, actorId: string, attemptId: string, dto: DecideAttemptDto): Promise<{ status: string; recordId: string | null }> {
    assertNotificationKind('SPORTS');
    assertNotificationOutboxKind('SPORTS_NOTICE');
    return withTenant(schoolId, async (tx) => {
      const a = await tx.sportsRecordAttempt.findFirst({ where: { id: attemptId, schoolId } });
      if (!a) throw new ApiError('RECORD_NOT_FOUND', 'That attempt is not in this school.', 404);
      if (a.status !== 'PENDING') throw new ApiError('ATTEMPT_DECIDED', `This attempt was already ${a.status.toLowerCase()}.`, 409);
      const now = new Date();
      if (!dto.approve) {
        await tx.sportsRecordAttempt.update({ where: { id: attemptId }, data: { status: 'REJECTED', decidedById: actorId, decidedAt: now } });
        await this.audit.record({ schoolId, actorUserId: actorId, action: 'sports.record.reject', entity: 'SportsRecordAttempt', entityId: attemptId, meta: { note: dto.note ?? null } });
        return { status: 'REJECTED', recordId: null };
      }
      const sport = resolveSport(a.sportKey, a.sportName);
      const scoring = sport?.scoring.type === 'MARK' ? sport.scoring : null;
      const year = istYear();
      const standing = await tx.sportsRecord.findFirst({ where: { schoolId, sportKey: a.sportKey, groupKey: a.groupKey, category: a.category, status: 'STANDING' } });
      if (standing && scoring && !beatsRecord(scoring, a.value, standing.value)) {
        // Somebody else's approval got in first with a better mark.
        await tx.sportsRecordAttempt.update({ where: { id: attemptId }, data: { status: 'REJECTED', decidedById: actorId, decidedAt: now } });
        return { status: 'REJECTED', recordId: null };
      }
      const student = await tx.student.findFirst({ where: { id: a.studentId, schoolId }, select: { firstName: true, lastName: true, userId: true } });
      const holderName = student ? `${student.firstName} ${student.lastName}`.trim() : 'Former student';
      if (standing) await tx.sportsRecord.update({ where: { id: standing.id }, data: { status: 'BROKEN', untilYear: year } });
      const rec = await tx.sportsRecord.create({
        data: {
          schoolId, sportKey: a.sportKey, groupKey: a.groupKey, category: a.category, value: a.value, unit: a.unit, holderName, holderStudentId: a.studentId,
          setOn: new Date(a.createdAt.toISOString().slice(0, 10) + 'T00:00:00Z'), sinceYear: year, status: 'STANDING', source: a.source, note: dto.note ?? null, verifiedById: actorId,
        },
        select: { id: true },
      });
      await tx.sportsRecordAttempt.update({ where: { id: attemptId }, data: { status: 'APPROVED', decidedById: actorId, decidedAt: now } });
      await this.audit.record({ schoolId, actorUserId: actorId, action: 'sports.record.approve', entity: 'SportsRecord', entityId: rec.id, meta: { attemptId, value: a.value } });

      const settings = this.settings.view(await this.settings.ensure(tx, schoolId));
      const line = `${groupLabel(settings.grouping, settings.bands, a.groupKey)} ${a.category}`;
      const text = scoring ? formatMark(scoring, a.value) : `${a.value} ${a.unit}`;
      const title = `School record: ${a.sportName}`;
      const body = standing ? `${text} — you beat the ${line} record of ${scoring ? formatMark(scoring, standing.value) : standing.value} (${standing.holderName}, ${standing.sinceYear}).` : `${text} — the first ${line} record in the book. Your name is in it.`;
      if (student?.userId) {
        await tx.notification.create({ data: { schoolId, userId: student.userId, kind: 'SPORTS', title, body, linkType: 'records', linkId: rec.id } });
        await tx.notificationOutbox.create({ data: { schoolId, kind: 'SPORTS_NOTICE', targetUserId: student.userId, payload: { title, body, recordId: rec.id } as unknown as Prisma.InputJsonValue } });
        this.sendLetter(schoolId, student.userId, title, body, holderName);
      }
      return { status: 'APPROVED', recordId: rec.id };
    });
  }

  /** A record from the old register, or a standing one typed in by hand. */
  async add(schoolId: string, actorId: string, dto: AddRecordDto): Promise<{ id: string }> {
    const sport = resolveSport(dto.sportKey);
    if (!sport || sport.scoring.type !== 'MARK') throw new ApiError('UNKNOWN_SPORT', 'Records are kept for measured and judged sports only.', 400, 'sportKey');
    const scoring = sport.scoring;
    if (dto.untilYear != null && dto.untilYear < dto.sinceYear) throw new ApiError('VALIDATION', 'A record cannot end before it was set.', 400, 'untilYear');
    return withTenant(schoolId, async (tx) => {
      const base = { schoolId, sportKey: sport.key, groupKey: dto.groupKey, category: dto.category, value: dto.value, unit: scoring.unit, holderName: dto.holderName.trim(), holderStudentId: dto.holderStudentId ?? null, setOn: dto.setOn ? new Date(`${dto.setOn}T00:00:00Z`) : null, sinceYear: dto.sinceYear, note: dto.note ?? null, source: 'IMPORT', verifiedById: actorId };
      if (dto.untilYear != null) {
        const row = await tx.sportsRecord.create({ data: { ...base, status: 'BROKEN', untilYear: dto.untilYear }, select: { id: true } });
        return row;
      }
      const standing = await tx.sportsRecord.findFirst({ where: { schoolId, sportKey: sport.key, groupKey: dto.groupKey, category: dto.category, status: 'STANDING' } });
      if (standing && !beatsRecord(scoring, dto.value, standing.value)) {
        throw new ApiError('VALIDATION', `${formatMark(scoring, dto.value)} does not beat the standing record ${formatMark(scoring, standing.value)} (${standing.holderName}, ${standing.sinceYear}). Add it as history with an end year instead.`, 400, 'value');
      }
      if (standing) await tx.sportsRecord.update({ where: { id: standing.id }, data: { status: 'BROKEN', untilYear: dto.sinceYear } });
      const row = await tx.sportsRecord.create({ data: { ...base, status: 'STANDING' }, select: { id: true } });
      await this.audit.record({ schoolId, actorUserId: actorId, action: 'sports.record.add', entity: 'SportsRecord', entityId: row.id, meta: { value: dto.value } });
      return row;
    });
  }

  /** Withdraw a record with a note. If it was standing, the previous holder stands again. */
  void(schoolId: string, actorId: string, recordId: string, note: string): Promise<{ restoredId: string | null }> {
    return withTenant(schoolId, async (tx) => {
      const r = await tx.sportsRecord.findFirst({ where: { id: recordId, schoolId } });
      if (!r) throw new ApiError('RECORD_NOT_FOUND', 'That record is not in this school.', 404);
      if (r.status === 'VOID') throw new ApiError('VALIDATION', 'This record is already void.', 400);
      await tx.sportsRecord.update({ where: { id: recordId }, data: { status: 'VOID', note: note.trim(), untilYear: r.untilYear ?? istYear() } });
      let restoredId: string | null = null;
      if (r.status === 'STANDING') {
        const prev = await tx.sportsRecord.findFirst({
          where: { schoolId, sportKey: r.sportKey, groupKey: r.groupKey, category: r.category, status: 'BROKEN' },
          orderBy: [{ untilYear: 'desc' }, { createdAt: 'desc' }], select: { id: true },
        });
        if (prev) {
          await tx.sportsRecord.update({ where: { id: prev.id }, data: { status: 'STANDING', untilYear: null } });
          restoredId = prev.id;
        }
      }
      await this.audit.record({ schoolId, actorUserId: actorId, action: 'sports.record.void', entity: 'SportsRecord', entityId: recordId, meta: { note, restoredId } });
      return { restoredId };
    });
  }

  /** The child's own page: records they hold and attempts waiting or decided. */
  mine(schoolId: string, studentId: string) {
    return withTenant(schoolId, async (tx) => {
      const [records, attempts] = await Promise.all([
        tx.sportsRecord.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, holderStudentId: studentId, status: { in: ['STANDING', 'BROKEN'] } }, orderBy: { sinceYear: 'desc' } }),
        tx.sportsRecordAttempt.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, studentId }, orderBy: { createdAt: 'desc' } }),
      ]);
      return {
        records: records.map(view),
        attempts: attempts.map((a) => {
          const sport = resolveSport(a.sportKey, a.sportName);
          return { id: a.id, sportName: a.sportName, groupKey: a.groupKey, category: a.category, text: sport?.scoring.type === 'MARK' ? formatMark(sport.scoring, a.value) : String(a.value), status: a.status, source: a.source, createdAt: a.createdAt };
        }),
      };
    });
  }

  private sendLetter(schoolId: string, userId: string, title: string, body: string, holderName: string): void {
    runInBackground(
      async () => {
        const [user, school] = await Promise.all([
          withTenant(schoolId, (tx) => tx.user.findFirst({ where: { id: userId, schoolId }, select: { email: true } })),
          withTenant(schoolId, (tx) => tx.school.findUnique({ where: { id: schoolId }, select: { name: true } })),
        ]);
        if (!user?.email) return;
        await this.mail.sendLetter(user.email, schoolId, `${school?.name ?? 'School'} — ${title}`, {
          title, intro: `${holderName}, congratulations. ${body}`, rows: [], note: 'The record stands in the school Book of Records until someone beats it. Keep going.',
        });
      },
      (e) => this.log.warn(`record letter failed: ${(e as Error).message}`),
    );
  }
}

function view(r: { id: string; sportKey: string; groupKey: string; category: string; value: number; unit: string; holderName: string; holderStudentId: string | null; setOn: Date | null; sinceYear: number; untilYear: number | null; status: string; source: string; note: string | null }): RecordView {
  const sport = resolveSport(r.sportKey);
  return {
    id: r.id, sportKey: r.sportKey, sportName: sport?.name ?? r.sportKey, groupKey: r.groupKey, category: r.category, value: r.value, unit: r.unit,
    text: sport?.scoring.type === 'MARK' ? formatMark(sport.scoring, r.value) : `${r.value} ${r.unit}`,
    holderName: r.holderName, holderStudentId: r.holderStudentId, setOn: iso(r.setOn), sinceYear: r.sinceYear, untilYear: r.untilYear, status: r.status, source: r.source, note: r.note,
  };
}
