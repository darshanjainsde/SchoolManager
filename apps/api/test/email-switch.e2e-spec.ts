/**
 * The email master switch on real Postgres, through the booted API.
 *
 * A test school full of made-up addresses turns email OFF in Settings →
 * Notifications → Email. From then on the REAL outbox drain, through the REAL
 * EmailChannel and MailService, must hand nothing to the mail server — each
 * email delivery ends SKIPPED 'channel-off', never FAILED or retried — while
 * the app (push) and WhatsApp carry on. Turning it back on sends again.
 *
 * Only the wire is stubbed: the identity's transporter is a spy, and the
 * send-time DNS check gets a fixed resolver so the suite never leaves the box.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/common/mail/mail.service';
import { MailIdentityService } from '../src/common/mail/mail-identity.service';
import { MailDomainCheck } from '../src/common/mail/mail-domain';
import { EmailChannel } from '../src/common/notifications/email.channel';
import { NotificationOutboxService } from '../src/modules/management/notification-outbox.service';
import type { DeliveryOutcome } from '../src/common/notifications/notification.types';
import { signSchoolToken, seedMinimalSchool, type MinimalSchool } from './integration/helpers';

describe('email master switch', () => {
  let app: INestApplication;
  let school: MinimalSchool;
  const db = () => getPlatformPrisma();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const sendMail = jest.fn(async () => ({ messageId: 'smtp-1' }));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    school = await seedMinimalSchool();

    // The wire only: everything else (the switch read, the ledger, the
    // suppression list) is the real code against the real database.
    const identity = app.get(MailIdentityService);
    const realForSchool = identity.forSchool.bind(identity);
    jest.spyOn(identity, 'forSchool').mockImplementation(async (sid) => ({ ...(await realForSchool(sid)), transporter: { sendMail } as never }));
    const mail = app.get(MailService) as unknown as { domains: MailDomainCheck };
    mail.domains = new MailDomainCheck({
      resolveMx: async (d) => (d === 'gmail.com' ? [{ exchange: 'aspmx.l.google.com', priority: 1 }] : Promise.reject(Object.assign(new Error('nx'), { code: 'ENOTFOUND' }))),
      resolve4: async () => Promise.reject(Object.assign(new Error('nx'), { code: 'ENOTFOUND' })),
    });
  });
  afterAll(async () => {
    const p = db();
    await p.notificationOutbox.deleteMany({ where: { schoolId: school.schoolId } });
    await p.emailDelivery.deleteMany({ where: { schoolId: school.schoolId } });
    await app.close();
    await disconnectAll();
  });
  beforeEach(() => sendMail.mockClear());

  const as = (role: 'SCHOOL_ADMIN' | 'TEACHER' | 'STAFF' | 'STUDENT', sub: string) => {
    const h = { 'X-Skoolos-Host': school.host, Authorization: `Bearer ${signSchoolToken({ sub, schoolId: school.schoolId, role })}` };
    return {
      get: (url: string) => request(app.getHttpServer()).get(url).set(h),
      put: (url: string, body: object) => request(app.getHttpServer()).put(url).set(h).send(body),
    };
  };

  /** The real drain with the real EmailChannel; push and WhatsApp answer SENT. */
  async function drain() {
    const sent: DeliveryOutcome = { status: 'SENT', providerId: 'stub' };
    const stub = { name: 'stub', send: async () => true, attempt: async () => sent };
    const svc = new NotificationOutboxService(stub as never, stub as never, app.get(EmailChannel));
    for (let i = 0; i < 10; i += 1) if (!(await svc.drain({ purge: false })).more) break;
  }

  async function leaveRequestTo(email: string) {
    const u = await db().user.create({ data: { schoolId: school.schoolId, email, role: 'TEACHER', passwordHash: 'x' }, select: { id: true } });
    const row = await db().notificationOutbox.create({
      data: {
        schoolId: school.schoolId,
        kind: 'LEAVE_APPLIED',
        targetUserId: u.id,
        payload: { schoolName: 'Switch School', leaveId: '11111111-1111-1111-1111-111111111111', teacherName: 'Priya Nair', dates: 'Mon 13 Oct', days: 1, reason: null, periodsAffected: 2 },
      },
      select: { id: true },
    });
    return row.id;
  }
  const deliveries = (outboxId: string) =>
    db().notificationDelivery.findMany({ where: { schoolId: school.schoolId, outboxId }, orderBy: { channel: 'asc' }, select: { channel: true, status: true, reason: true, attempts: true } });

  // ── the door ───────────────────────────────────────────────────────────

  it('only the school admin reads or flips the switch; a new school starts ON', async () => {
    const admin = as('SCHOOL_ADMIN', school.adminUserId);
    const fresh = await admin.get('/manage/email-settings').expect(200);
    expect(fresh.body.settings.enabled).toBe(true);

    for (const [role, sub] of [['TEACHER', school.teacherUserId], ['STAFF', school.staffUserId], ['STUDENT', school.studentUserId]] as const) {
      await as(role, sub).put('/manage/email-settings', { enabled: false }).expect(403);
      await as(role, sub).get('/manage/email-settings').expect(403);
    }
    // Nobody signed in: 401, not 403.
    await request(app.getHttpServer()).put('/manage/email-settings').set('X-Skoolos-Host', school.host).send({ enabled: false }).expect(401);
    expect((await admin.get('/manage/email-settings').expect(200)).body.settings.enabled).toBe(true);
  });

  it('rejects a switch that is not a boolean', async () => {
    const r = await as('SCHOOL_ADMIN', school.adminUserId).put('/manage/email-settings', { enabled: 'no' });
    expect(r.status).toBe(400);
  });

  it('the switch does not disturb the letterhead, and a letterhead save does not flip the switch', async () => {
    const admin = as('SCHOOL_ADMIN', school.adminUserId);
    await admin.put('/manage/email-settings', { template: 'BANNER', footerLines: ['12 MG Road'] }).expect(200);
    const off = await admin.put('/manage/email-settings', { enabled: false }).expect(200);
    expect(off.body.settings).toMatchObject({ enabled: false, template: 'BANNER', footerLines: ['12 MG Road'] });
    const saved = await admin.put('/manage/email-settings', { template: 'MINIMAL' }).expect(200);
    expect(saved.body.settings).toMatchObject({ enabled: false, template: 'MINIMAL' });
  });

  // ── the drain ──────────────────────────────────────────────────────────

  it('OFF: the drain hands the mail server nothing; email ends SKIPPED channel-off, app and WhatsApp still go', async () => {
    await as('SCHOOL_ADMIN', school.adminUserId).put('/manage/email-settings', { enabled: false }).expect(200);
    const id = await leaveRequestTo(`real-person-${suffix}@gmail.com`);
    await drain();

    expect(sendMail).not.toHaveBeenCalled();
    expect(await deliveries(id)).toEqual([
      { channel: 'EMAIL', status: 'SKIPPED', reason: 'channel-off', attempts: 0 },
      { channel: 'PUSH', status: 'SENT', reason: null, attempts: 1 },
      { channel: 'WHATSAPP', status: 'SENT', reason: null, attempts: 1 },
    ]);
    // Not a bounce, not "not delivered": nothing for the office to fix.
    expect(await db().emailDelivery.count({ where: { schoolId: school.schoolId, to: `real-person-${suffix}@gmail.com` } })).toBe(0);
  });

  it('OFF: a password reset — asked for at the door by the person — still goes', async () => {
    const ok = await app.get(MailService).sendPasswordReset(`admin-${suffix}@gmail.com`, 'Switch School', 'https://x.sckools.com/reset', school.schoolId);
    expect(ok).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('ON again: the next message is sent, and an address on a test domain is stopped before the server', async () => {
    await as('SCHOOL_ADMIN', school.adminUserId).put('/manage/email-settings', { enabled: true }).expect(200);
    const good = await leaveRequestTo(`real2-${suffix}@gmail.com`);
    const fake = await leaveRequestTo(`teacher-${suffix}@raffles.test`);
    await drain();

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: `real2-${suffix}@gmail.com` }));
    expect((await deliveries(good)).find((d) => d.channel === 'EMAIL')).toMatchObject({ status: 'SENT', attempts: 1 });
    expect((await deliveries(fake)).find((d) => d.channel === 'EMAIL')).toMatchObject({ status: 'SUPPRESSED', attempts: 0, reason: expect.stringMatching(/raffles\.test is a test domain/) });
    // The office sees WHY in the email log.
    const row = await db().emailDelivery.findFirstOrThrow({ where: { schoolId: school.schoolId, to: `teacher-${suffix}@raffles.test` } });
    expect(row).toMatchObject({ status: 'SUPPRESSED', provider: 'none' });
  });

  it('a made-up domain with no mail server is stopped too (DNS answered "no such name")', async () => {
    const out: { outcome?: unknown } = {};
    const ok = await app.get(MailService).sendLetter(`p@nowhere-${suffix}.in`, school.schoolId, 's', { title: 't', intro: 'i' }, 'ANNOUNCEMENT', out as never);
    expect(ok).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
    expect(out.outcome).toMatchObject({ status: 'SUPPRESSED', reason: `nothing receives mail at nowhere-${suffix}.in` });
  });
});
