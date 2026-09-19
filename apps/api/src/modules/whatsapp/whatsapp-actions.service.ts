import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma, type PrismaClient } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { WhatsAppChannel } from '../../common/notifications/whatsapp.channel';
import { coverPayload, parseAction, type Action } from '../../common/notifications/whatsapp/actions';
import { sendList, sendTemplate, sendText } from '../../common/notifications/whatsapp/graph.client';
import { coverPendingTemplate, COVER_PENDING } from '../../common/notifications/whatsapp/templates';
import { isoWeekdayOf, LeaveService, toDateStr } from '../management';
import type { InboundMessage } from './whatsapp-webhook.service';

/**
 * What happens when someone taps a button we sent. The tap arrives on the
 * webhook as a signed payload (whatsapp/actions.ts); this turns it into the
 * SAME service call the console makes — `LeaveService.approve()` /
 * `reject()` / `assign()` — so the Requests tab, the app and the ledger all
 * see one truth, and nothing here is a second implementation of leave.
 *
 * Who may tap: only a login of THAT school whose verified WhatsApp number
 * is the number that tapped — an admin for leave and cover, the substitute
 * themself for an acknowledgement. Everything else is answered in words and
 * recorded, never acted on.
 *
 * Idempotent: Meta retries webhooks; every inbound is keyed by Meta's
 * message id in WhatsAppInbound, and a repeat is a no-op.
 *
 * Meta's 24-hour rule: the tap opens a window in which free text and the
 * cover list may be sent; a tap after the window is still acted on (the
 * approval goes through) and the follow-up falls back to a template that
 * points at the console.
 */
const OUT_OF_WINDOW = 131047;
const NO_ROWS_CAP = 9; // Meta's list holds 10; the last row is "decide in the console".

/** ApiError keeps its code in the HttpException body ({ code, message, field }). */
const apiCode = (e: unknown): string | null => (e instanceof ApiError ? ((e.getResponse() as { code?: string }).code ?? null) : null);

type Db = PrismaClient;

@Injectable()
export class WhatsAppActionsService {
  private readonly logger = new Logger(WhatsAppActionsService.name);

  constructor(
    private readonly leave: LeaveService,
    private readonly channel: WhatsAppChannel,
  ) {}

  private secret(): string {
    return process.env.META_APP_SECRET?.trim() || 'unset';
  }

  async handleInbound(m: InboundMessage): Promise<string> {
    const db = getPlatformPrisma();
    const phone = `+${m.from.replace(/^\+/, '')}`;
    const payload = m.button?.payload ?? m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? null;
    const kind = m.button ? 'button' : m.interactive?.list_reply ? 'list' : m.interactive?.button_reply ? 'button' : m.text ? 'text' : 'other';
    // Idempotency first: a retried webhook must not approve twice.
    try {
      await db.whatsAppInbound.create({ data: { id: m.id, phone, kind, payload: (payload ?? m.text?.body ?? m.type).slice(0, 1000) } });
    } catch {
      return 'duplicate';
    }
    let result = 'ignored';
    let schoolId: string | null = null;
    try {
      if (!payload) {
        result = 'text'; // a reply in words — the Messages inbox is the next phase
      } else {
        const action = parseAction(payload, this.secret());
        if (!action) result = 'unknown-payload';
        else ({ result, schoolId } = await this.act(db, action, phone));
      }
    } catch (e) {
      result = `error: ${(e as Error).message}`.slice(0, 200);
      this.logger.error(`WhatsApp action failed for ${m.id}: ${(e as Error).message}`);
    }
    await db.whatsAppInbound.update({ where: { id: m.id }, data: { result, schoolId } }).catch(() => undefined);
    return result;
  }

  private async act(db: Db, action: Action, phone: string): Promise<{ result: string; schoolId: string | null }> {
    if (action.kind === 'leave') return this.onLeave(db, action, phone);
    if (action.kind === 'cover') return this.onCover(db, action, phone);
    return this.onAck(db, action, phone);
  }

  // ── leave: Approve / Reject ────────────────────────────────────────────

  private async onLeave(db: Db, a: Extract<Action, { kind: 'leave' }>, phone: string) {
    const app = await db.leaveApplication.findUnique({ where: { id: a.leaveId }, select: { id: true, schoolId: true, status: true, teacherId: true, reviewedById: true, reviewedAt: true } });
    if (!app) return { result: 'leave-not-found', schoolId: null };
    const admin = await this.adminByPhone(db, app.schoolId, phone);
    if (!admin) {
      await this.text(app.schoolId, phone, 'This number is not a verified admin of the school, so nothing was changed. Verify it under Settings → My WhatsApp number, or decide in the console.');
      return { result: 'not-admin', schoolId: app.schoolId };
    }
    const teacher = await db.teacher.findFirst({ where: { id: app.teacherId, schoolId: app.schoolId }, select: { firstName: true, lastName: true } });
    const teacherName = teacher ? `${teacher.firstName} ${teacher.lastName ?? ''}`.trim() : 'The teacher';
    try {
      if (a.decision === 'approve') {
        const { gaps, gapIds } = await this.leave.approve(app.schoolId, app.id, admin.id);
        if (gaps === 0) {
          await this.text(app.schoolId, phone, `Approved. ${teacherName} has been told. No classes need cover.`);
          return { result: 'approved', schoolId: app.schoolId };
        }
        await this.text(app.schoolId, phone, `Approved. ${teacherName} has been told. ${gaps} period${gaps === 1 ? '' : 's'} need cover — pick a teacher for each below, or leave it for the console.`);
        await this.coverList(db, app.schoolId, phone, gapIds[0]);
        return { result: `approved:${gaps}`, schoolId: app.schoolId };
      }
      await this.leave.reject(app.schoolId, app.id, admin.id);
      await this.text(app.schoolId, phone, `Not approved. ${teacherName} has been told.`);
      return { result: 'rejected', schoolId: app.schoolId };
    } catch (e) {
      if (apiCode(e) === 'LEAVE_NOT_PENDING') {
        const fresh = await db.leaveApplication.findUnique({ where: { id: app.id }, select: { status: true, reviewedAt: true } });
        const when = fresh?.reviewedAt ? ` at ${fresh.reviewedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}` : '';
        await this.text(app.schoolId, phone, `This request was already ${fresh?.status === 'APPROVED' ? 'approved' : fresh?.status === 'REJECTED' ? 'rejected' : 'decided'}${when}. Nothing changed.`);
        return { result: 'already-decided', schoolId: app.schoolId };
      }
      throw e;
    }
  }

  // ── cover: a pick from the list ────────────────────────────────────────

  private async onCover(db: Db, a: Extract<Action, { kind: 'cover' }>, phone: string) {
    const sub = await db.substitution.findUnique({ where: { id: a.substitutionId }, select: { id: true, schoolId: true, date: true, periodId: true, classSectionId: true, originalTeacherId: true, substituteTeacherId: true } });
    if (!sub) return { result: 'gap-not-found', schoolId: null };
    const admin = await this.adminByPhone(db, sub.schoolId, phone);
    if (!admin) {
      await this.text(sub.schoolId, phone, 'This number is not a verified admin of the school, so nothing was changed.');
      return { result: 'not-admin', schoolId: sub.schoolId };
    }
    if (a.teacherId === 'skip') {
      await this.text(sub.schoolId, phone, 'Left for the console. The remaining gaps are under Requests → Coverage.');
      return { result: 'skipped', schoolId: sub.schoolId };
    }
    if (sub.substituteTeacherId) {
      await this.text(sub.schoolId, phone, 'That period is already covered. Moving on.');
      await this.nextGap(db, sub, phone);
      return { result: 'already-covered', schoolId: sub.schoolId };
    }
    try {
      await this.leave.assign(sub.schoolId, sub.id, { substituteTeacherId: a.teacherId });
    } catch (e) {
      if (apiCode(e) === 'TEACHER_CONFLICT' || apiCode(e) === 'VALIDATION') {
        await this.text(sub.schoolId, phone, 'That teacher is no longer free then — pick another.');
        await this.coverList(db, sub.schoolId, phone, sub.id);
        return { result: 'conflict', schoolId: sub.schoolId };
      }
      throw e;
    }
    const t = await db.teacher.findFirst({ where: { id: a.teacherId, schoolId: sub.schoolId }, select: { firstName: true, lastName: true } });
    const when = await this.whenOf(db, sub.schoolId, sub.date, sub.periodId, sub.classSectionId);
    await this.text(sub.schoolId, phone, `Done — ${t ? `${t.firstName} ${t.lastName ?? ''}`.trim() : 'the teacher'} covers ${when.className} on ${when.when}. They have been told.`);
    await this.nextGap(db, sub, phone);
    return { result: `assigned:${a.teacherId}`, schoolId: sub.schoolId };
  }

  private async nextGap(db: Db, sub: { schoolId: string; date: Date; originalTeacherId: string; id: string }, phone: string): Promise<void> {
    const next = await db.substitution.findFirst({
      where: { schoolId: sub.schoolId, originalTeacherId: sub.originalTeacherId, substituteTeacherId: null, date: { gte: sub.date }, NOT: { id: sub.id } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    if (next) await this.coverList(db, sub.schoolId, phone, next.id);
    else await this.text(sub.schoolId, phone, 'Every period is covered. Thank you.');
  }

  // ── ack: the substitute says "got it" ──────────────────────────────────

  private async onAck(db: Db, a: Extract<Action, { kind: 'ack' }>, phone: string) {
    const sub = await db.substitution.findUnique({ where: { id: a.substitutionId }, select: { schoolId: true, substituteTeacherId: true } });
    if (!sub?.substituteTeacherId) return { result: 'gap-not-found', schoolId: sub?.schoolId ?? null };
    const teacher = await db.teacher.findFirst({ where: { id: sub.substituteTeacherId, schoolId: sub.schoolId }, select: { userId: true } });
    const user = teacher?.userId ? await db.user.findFirst({ where: { id: teacher.userId, schoolId: sub.schoolId, phone, phoneVerifiedAt: { not: null } }, select: { id: true } }) : null;
    if (!user) return { result: 'ack-not-substitute', schoolId: sub.schoolId };
    await this.text(sub.schoolId, phone, 'Noted — thank you.');
    return { result: 'acked', schoolId: sub.schoolId };
  }

  // ── the cover list ─────────────────────────────────────────────────────

  /**
   * "Who covers this period?" — teachers of the school who are free: no
   * timetable slot of their own then, not already covering another gap
   * then, not the teacher on leave, not themselves on leave that day.
   * Same-subject teachers first, then by name; nine rows and a way out.
   */
  async coverList(db: Db, schoolId: string, phone: string, substitutionId: string): Promise<void> {
    const sub = await db.substitution.findUnique({ where: { id: substitutionId }, select: { id: true, date: true, periodId: true, classSectionId: true, originalTeacherId: true } });
    if (!sub) return;
    const weekday = isoWeekdayOf(toDateStr(sub.date));
    const [slot, busy, covering, onLeave, teachers] = await Promise.all([
      db.timetableSlot.findFirst({ where: { schoolId, classSectionId: sub.classSectionId, periodId: sub.periodId, dayOfWeek: weekday, effectiveTo: null }, select: { subjectId: true } }),
      db.timetableSlot.findMany({ where: { schoolId, dayOfWeek: weekday, periodId: sub.periodId, effectiveTo: null }, select: { teacherId: true } }),
      db.substitution.findMany({ where: { schoolId, date: sub.date, periodId: sub.periodId, substituteTeacherId: { not: null } }, select: { substituteTeacherId: true } }),
      db.staffAttendance.findMany({ where: { schoolId, date: sub.date, status: 'ON_LEAVE' }, select: { teacherId: true } }),
      db.teacher.findMany({ where: { schoolId, userId: { not: null } }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ firstName: 'asc' }] }),
    ]);
    const out = new Set<string>([sub.originalTeacherId, ...busy.map((b) => b.teacherId), ...covering.map((c) => c.substituteTeacherId), ...onLeave.map((o) => o.teacherId)].filter((x): x is string => !!x));
    const free = teachers.filter((t) => !out.has(t.id));
    const teachesSubject = new Set<string>();
    if (slot?.subjectId) {
      const rows = await db.timetableSlot.findMany({ where: { schoolId, subjectId: slot.subjectId, effectiveTo: null, teacherId: { in: free.map((t) => t.id) } }, select: { teacherId: true }, distinct: ['teacherId'] });
      for (const r of rows) teachesSubject.add(r.teacherId);
    }
    free.sort((a, b) => Number(teachesSubject.has(b.id)) - Number(teachesSubject.has(a.id)) || a.firstName.localeCompare(b.firstName));
    const when = await this.whenOf(db, schoolId, sub.date, sub.periodId, sub.classSectionId);
    const secret = this.secret();
    if (free.length === 0) {
      await this.text(schoolId, phone, `Nobody is free for ${when.className} on ${when.when}. Decide in the console.`);
      return;
    }
    const rows = free.slice(0, NO_ROWS_CAP).map((t) => ({
      id: coverPayload(sub.id, t.id, secret),
      title: `${t.firstName} ${t.lastName ?? ''}`.trim(),
      description: teachesSubject.has(t.id) ? `teaches ${when.subjectName ?? 'this subject'}` : 'free this period',
    }));
    rows.push({ id: coverPayload(sub.id, 'skip', secret), title: 'Decide in the console', description: 'leave this one for later' });
    const sent = await this.channel.deliverWith(schoolId, phone, 'COVER_LIST', 'interactive:list', (cfg, pnid, f) =>
      sendList(cfg, phone, { header: 'Who covers?', body: `${when.className}${when.subjectName ? ` · ${when.subjectName}` : ''}\n${when.when}`, button: 'Pick a teacher', rows, footer: `${free.length} free` }, { phoneNumberId: pnid, fetchImpl: f }),
    );
    if (!sent.ok && sent.code === OUT_OF_WINDOW) {
      const school = await db.school.findFirst({ where: { id: schoolId }, select: { name: true } });
      const open = await db.substitution.count({ where: { schoolId, originalTeacherId: sub.originalTeacherId, substituteTeacherId: null, date: { gte: sub.date } } });
      await this.channel.deliverWith(schoolId, phone, 'COVER_PENDING', COVER_PENDING, (cfg, pnid, f) => sendTemplate(cfg, phone, coverPendingTemplate(school?.name ?? 'The school', open), { phoneNumberId: pnid, fetchImpl: f }));
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private adminByPhone(db: Db, schoolId: string, phone: string) {
    return db.user.findFirst({ where: { schoolId, phone, phoneVerifiedAt: { not: null }, role: 'SCHOOL_ADMIN', isActive: true }, select: { id: true } });
  }

  private text(schoolId: string, phone: string, body: string) {
    return this.channel.deliverWith(schoolId, phone, 'REPLY', 'text', (cfg, pnid, f) => sendText(cfg, phone, body, { phoneNumberId: pnid, fetchImpl: f }));
  }

  /** `{ when: 'Mon 22 Sep, period 3 (10:15–11:00)', className: '9-A', subjectName }`. */
  async whenOf(db: Db, schoolId: string, date: Date, periodId: string, classSectionId: string) {
    const [period, section, slot] = await Promise.all([
      db.period.findFirst({ where: { id: periodId, schoolId }, select: { label: true, order: true, startTime: true, endTime: true } }),
      db.classSection.findFirst({ where: { id: classSectionId, schoolId }, select: { name: true } }),
      db.timetableSlot.findFirst({ where: { schoolId, classSectionId, periodId, dayOfWeek: isoWeekdayOf(toDateStr(date)), effectiveTo: null }, select: { subject: { select: { name: true } } } }),
    ]);
    const d = new Date(`${toDateStr(date)}T00:00:00Z`);
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    const when = `${day} ${d.getUTCDate()} ${mon}, ${period ? `${period.label} (${period.startTime}–${period.endTime})` : 'a period'}`;
    return { when, className: section?.name ?? 'a class', subjectName: slot?.subject?.name ?? null };
  }
}
