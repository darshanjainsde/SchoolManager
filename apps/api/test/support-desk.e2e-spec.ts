import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { loadEnv } from '@skoolos/config';
import { disconnectAll, getPlatformPrisma, withTenant } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/common/mail/mail.service';
import { StorageService } from '../src/common/storage/storage.service';
import { seedMinimalSchool, signPlatformToken, signSchoolToken, type MinimalSchool } from './integration/helpers';

/**
 * The Support desk, end to end against the booted app and a real Postgres.
 *
 * Object storage and the mailbox are the two things the test environment
 * cannot reach (S3_ENDPOINT and SMTP_HOST both point at .invalid), so both are
 * replaced with fakes that RECORD: the storage fake keeps keys so the file
 * route can be proven to check them, the mail fake keeps subjects so the owner
 * alert can be proven to fire. Everything else — RLS, the status machine,
 * private notes, consent, limits, the sweep — runs for real.
 */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const DAY = 86_400_000;

describe('the support desk', () => {
  let app: INestApplication;
  let one: MinimalSchool;
  let two: MinimalSchool;
  let adminOne: string;
  let adminTwo: string;
  const ownerSub = '11111111-2222-4333-8444-555555555555';
  let owner: string;
  const ownerHost = loadEnv().PLATFORM_OWNER_HOST;
  const stored = new Set<string>();
  const sent: { to: string; subject: string }[] = [];
  const db = getPlatformPrisma();

  const fakeStorage = {
    upload: jest.fn(async (prefix: string, filename: string) => {
      const key = `${prefix}/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      stored.add(key);
      return { key, url: '' };
    }),
    delete: jest.fn(async (key: string) => { stored.delete(key); }),
    presignedGet: jest.fn(async (key: string) => `https://files.test/${key}?sig=1`),
    publicUrl: jest.fn(() => ''),
  };
  const fakeMail = {
    sendLetter: jest.fn(async (to: string, _schoolId: string | null, subject: string) => { sent.push({ to, subject }); return true; }),
  };

  beforeAll(async () => {
    one = await seedMinimalSchool();
    two = await seedMinimalSchool();
    adminOne = signSchoolToken({ sub: one.adminUserId, schoolId: one.schoolId, role: 'SCHOOL_ADMIN' });
    adminTwo = signSchoolToken({ sub: two.adminUserId, schoolId: two.schoolId, role: 'SCHOOL_ADMIN' });
    owner = signPlatformToken(ownerSub);
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService).useValue(fakeStorage)
      .overrideProvider(MailService).useValue(fakeMail)
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  const asSchool = (token: string, host: string) => ({ Authorization: `Bearer ${token}`, 'X-Skoolos-Host': host });
  const asOwner = () => ({ Authorization: `Bearer ${owner}`, 'X-Skoolos-Host': ownerHost });
  const api = () => request(app.getHttpServer());

  const raise = (token: string, host: string, over: Record<string, string> = {}, files = 2) => {
    let req = api().post('/manage/support').set(asSchool(token, host))
      .field('type', over.type ?? 'BUG')
      .field('module', over.module ?? 'FEES')
      .field('severity', over.severity ?? 'BLOCKING')
      .field('title', over.title ?? 'Receipt PDF fails for one student')
      .field('body', over.body ?? 'Pressing Print receipt for one student shows "Something went wrong".')
      .field('pagePath', '/app/fees/counter')
      .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');
    if (over.allowLookIn) req = req.field('allowLookIn', over.allowLookIn);
    for (let i = 0; i < files; i++) req = req.attach('files', PNG, { filename: `shot-${i}.png`, contentType: 'image/png' });
    return req;
  };

  let ticketId: string;
  let fileKey: string;

  it('a school admin raises a ticket with two photos and gets a number, captured context and OPEN', async () => {
    const res = await raise(adminOne, one.host).expect(201);
    ticketId = res.body.id;
    expect(res.body.ticketNo).toMatch(/^SK-\d{6}$/);
    expect(res.body.status).toBe('OPEN');
    expect(res.body.attachments).toHaveLength(2);
    expect(res.body.attachments[0].name).toBe('shot-0.png');
    expect(res.body.context).toMatchObject({ pagePath: '/app/fees/counter', tier: 'PRO', browser: 'Chrome on Windows' });
    expect(res.body.unanswered).toBe(true);
    expect(res.body.school).toBeNull();
    fileKey = res.body.attachments[0].key;
    expect(fileKey.startsWith(`support/${one.schoolId}/${ticketId}/`)).toBe(true);
    // The owner heard about it, at the marketing contact address.
    expect(sent.some((m) => m.subject.startsWith(res.body.ticketNo) && m.subject.includes('raised'))).toBe(true);
  });

  it('refuses a file whose bytes are not an image, and more than five files, recording nothing', async () => {
    const before = await db.supportTicket.count({ where: { schoolId: one.schoolId } });
    await api().post('/manage/support').set(asSchool(adminOne, one.host))
      .field('type', 'BUG').field('module', 'FEES').field('severity', 'ANNOYING').field('title', 'Not an image').field('body', 'Attached a text file named as a jpeg.')
      .attach('files', Buffer.from('hello world, not a picture'), { filename: 'x.jpg', contentType: 'image/jpeg' })
      .expect(400);
    let six = api().post('/manage/support').set(asSchool(adminOne, one.host))
      .field('type', 'BUG').field('module', 'FEES').field('severity', 'ANNOYING').field('title', 'Six files').field('body', 'Too many photos attached.');
    for (let i = 0; i < 6; i++) six = six.attach('files', PNG, { filename: `p${i}.png`, contentType: 'image/png' });
    await six.expect(400);
    expect(await db.supportTicket.count({ where: { schoolId: one.schoolId } })).toBe(before);
  });

  it("a second school's admin cannot see the ticket: 404 on detail, nothing in the list, 404 on the file", async () => {
    await api().get(`/manage/support/${ticketId}`).set(asSchool(adminTwo, two.host)).expect(404);
    const list = await api().get('/manage/support').set(asSchool(adminTwo, two.host)).expect(200);
    expect(list.body).toEqual([]);
    await api().get(`/manage/support/${ticketId}/file`).query({ key: fileKey }).set(asSchool(adminTwo, two.host)).expect(404);
  });

  it('a tenant cannot forge a ticket owned by another school (RLS)', async () => {
    await expect(
      withTenant(one.schoolId, (tx) =>
        tx.supportTicket.create({
          data: { schoolId: two.schoolId, raisedById: two.adminUserId, type: 'BUG', module: 'FEES', severity: 'ANNOYING', title: 'forged', body: 'forged' },
        }),
      ),
    ).rejects.toThrow(/row-level security|42501/);
  });

  it('the owner board lists the school with its open ticket, oldest unanswered first; the badge counts it', async () => {
    const board = await api().get('/owner/support/board').set(asOwner()).expect(200);
    const row = board.body.schools.find((s: { schoolId: string }) => s.schoolId === one.schoolId);
    expect(row).toMatchObject({ open: 1, oldestUnansweredTitle: 'Receipt PDF fails for one student', tier: 'PRO' });
    expect(board.body.counts.unanswered).toBeGreaterThanOrEqual(1);
    const counts = await api().get('/owner/support/counts').set(asOwner()).expect(200);
    expect(counts.body.unanswered).toBeGreaterThanOrEqual(1);
    const list = await api().get('/owner/support/tickets').query({ schoolId: one.schoolId }).set(asOwner()).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].school).toMatchObject({ id: one.schoolId });
  });

  it('acknowledging tells the school: status moves, a bell row and an outbox row land for the raiser', async () => {
    const res = await api().post(`/owner/support/${ticketId}/status`).set(asOwner()).send({ status: 'ACKNOWLEDGED', note: 'Looking at it now.' }).expect(200);
    expect(res.body.status).toBe('ACKNOWLEDGED');
    expect(res.body.unanswered).toBe(false);
    const mine = await api().get(`/manage/support/${ticketId}`).set(asSchool(adminOne, one.host)).expect(200);
    expect(mine.body.status).toBe('ACKNOWLEDGED');
    expect(mine.body.entries.map((e: { statusTo: string | null }) => e.statusTo)).toContain('ACKNOWLEDGED');
    const bell = await db.notification.findMany({ where: { schoolId: one.schoolId, userId: one.adminUserId, kind: 'SUPPORT' } });
    expect(bell.length).toBeGreaterThanOrEqual(1);
    expect(bell[0]).toMatchObject({ linkType: 'support', linkId: ticketId, title: 'Sckools picked up your ticket' });
    const outbox = await db.notificationOutbox.findMany({ where: { schoolId: one.schoolId, kind: 'SUPPORT_UPDATE', targetUserId: one.adminUserId } });
    expect(outbox.length).toBeGreaterThanOrEqual(1);
  });

  it('a private note never reaches the school, and does not count as answering', async () => {
    const res = await api().post(`/owner/support/${ticketId}/comment`).set(asOwner())
      .send({ body: 'FeeReceipt row has a null studentCategory. GH #412.', visibleToSchool: false }).expect(200);
    expect(res.body.entries.some((e: { body: string; visibleToSchool: boolean }) => e.body.includes('GH #412') && !e.visibleToSchool)).toBe(true);
    const mine = await api().get(`/manage/support/${ticketId}`).set(asSchool(adminOne, one.host)).expect(200);
    expect(mine.body.entries.some((e: { body: string }) => e.body.includes('GH #412'))).toBe(false);
    const bellBefore = await db.notification.count({ where: { userId: one.adminUserId, kind: 'SUPPORT' } });
    expect(bellBefore).toBe(1);
  });

  it("while waiting on the school, the school's reply flips it back to in progress and alerts the owner", async () => {
    await api().post(`/owner/support/${ticketId}/status`).set(asOwner()).send({ status: 'WAITING_ON_SCHOOL', note: 'Could you set a category for the student and try again?' }).expect(200);
    const before = sent.length;
    const res = await api().post(`/manage/support/${ticketId}/comment`).set(asSchool(adminOne, one.host))
      .field('body', 'Done — still fails.').attach('files', PNG, { filename: 'again.png', contentType: 'image/png' }).expect(200);
    expect(res.body.status).toBe('IN_PROGRESS');
    expect(res.body.unanswered).toBe(true);
    const reply = res.body.entries.find((e: { body: string }) => e.body === 'Done — still fails.');
    expect(reply.attachments).toHaveLength(1);
    expect(sent.length).toBe(before + 1);
    expect(sent[sent.length - 1].subject).toContain('replied on');
  });

  it('refuses an illegal owner move and leaves the status untouched', async () => {
    const res = await api().post(`/owner/support/${ticketId}/status`).set(asOwner()).send({ status: 'CLOSED' }).expect(409);
    expect(res.body.code).toBe('SUPPORT_ILLEGAL_MOVE');
    const t = await db.supportTicket.findUnique({ where: { id: ticketId }, select: { status: true } });
    expect(t?.status).toBe('IN_PROGRESS');
  });

  it('the school cannot confirm an unresolved ticket; after RESOLVED, confirm closes it', async () => {
    await api().post(`/manage/support/${ticketId}/confirm`).set(asSchool(adminOne, one.host)).expect(409);
    const resolved = await api().post(`/owner/support/${ticketId}/status`).set(asOwner()).send({ status: 'RESOLVED', note: 'Fixed in the composer.' }).expect(200);
    expect(resolved.body.resolvedAt).not.toBeNull();
    const mine = await api().get(`/manage/support/${ticketId}`).set(asSchool(adminOne, one.host)).expect(200);
    expect(mine.body.canConfirm).toBe(true);
    expect(mine.body.canReopen).toBe(true);
    const closed = await api().post(`/manage/support/${ticketId}/confirm`).set(asSchool(adminOne, one.host)).expect(200);
    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.closedAt).not.toBeNull();
    expect(closed.body.canConfirm).toBe(false);
  });

  it('reopen works inside the window and is refused outside it', async () => {
    const res = await api().post(`/manage/support/${ticketId}/reopen`).set(asSchool(adminOne, one.host)).send({ body: 'It came back this morning.' }).expect(200);
    expect(res.body.status).toBe('OPEN');
    expect(res.body.reopenedAt).not.toBeNull();
    expect(res.body.resolvedAt).toBeNull();
    expect(sent[sent.length - 1].subject).toContain('reopened');
    // Resolve again, then age the resolution past the window.
    await api().post(`/owner/support/${ticketId}/status`).set(asOwner()).send({ status: 'RESOLVED' }).expect(200);
    await db.supportTicket.update({ where: { id: ticketId }, data: { resolvedAt: new Date(Date.now() - 15 * DAY) } });
    const late = await api().post(`/manage/support/${ticketId}/reopen`).set(asSchool(adminOne, one.host)).send({ body: 'Too late?' }).expect(400);
    expect(late.body.code).toBe('SUPPORT_REOPEN_WINDOW');
    const mine = await api().get(`/manage/support/${ticketId}`).set(asSchool(adminOne, one.host)).expect(200);
    expect(mine.body.canReopen).toBe(false);
    // Pull it back to in progress for the tests below.
    await api().post(`/owner/support/${ticketId}/status`).set(asOwner()).send({ status: 'IN_PROGRESS' }).expect(200);
  });

  it('"Open as this school" needs live consent; consent is a clock the school controls; every use is on the timeline', async () => {
    const refused = await api().post(`/owner/support/${ticketId}/open-school`).set(asOwner()).expect(409);
    expect(refused.body.code).toBe('SUPPORT_LOOK_IN_REQUIRED');
    const allowed = await api().post(`/manage/support/${ticketId}/look-in`).set(asSchool(adminOne, one.host)).send({ allow: true }).expect(200);
    const until = new Date(allowed.body.lookInUntil).getTime();
    expect(until - Date.now()).toBeGreaterThan(47 * 3_600_000);
    expect(until - Date.now()).toBeLessThan(49 * 3_600_000);
    const opened = await api().post(`/owner/support/${ticketId}/open-school`).set(asOwner()).expect(200);
    expect(opened.body.url).toContain('/login?imp=');
    const mine = await api().get(`/manage/support/${ticketId}`).set(asSchool(adminOne, one.host)).expect(200);
    expect(mine.body.entries.some((e: { authorKind: string; body: string }) => e.authorKind === 'SYSTEM' && /opened your console/.test(e.body))).toBe(true);
    const withdrawn = await api().post(`/manage/support/${ticketId}/look-in`).set(asSchool(adminOne, one.host)).send({ allow: false }).expect(200);
    expect(withdrawn.body.lookInUntil).toBeNull();
    await api().post(`/owner/support/${ticketId}/open-school`).set(asOwner()).expect(409);
  });

  it('a file is served only by a key that is on the ticket, to either side', async () => {
    const mine = await api().get(`/manage/support/${ticketId}/file`).query({ key: fileKey }).set(asSchool(adminOne, one.host)).expect(200);
    expect(mine.body).toMatchObject({ name: 'shot-0.png', expiresInSeconds: 300 });
    expect(mine.body.url).toContain(fileKey);
    const theirs = await api().get(`/owner/support/${ticketId}/file`).query({ key: fileKey }).set(asOwner()).expect(200);
    expect(theirs.body.url).toContain(fileKey);
    await api().get(`/manage/support/${ticketId}/file`).query({ key: `support/${one.schoolId}/other/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f-x.png` }).set(asSchool(adminOne, one.host)).expect(404);
    await api().get(`/manage/support/${ticketId}/file`).query({ key: 'print-orders/anything.pdf' }).set(asSchool(adminOne, one.host)).expect(404);
    await api().get(`/manage/support/${ticketId}/file`).set(asSchool(adminOne, one.host)).expect(404);
    expect(fakeStorage.presignedGet).not.toHaveBeenCalledWith('print-orders/anything.pdf', expect.anything());
  });

  it('the owner can take it, note a reference, and the school never sees the reference', async () => {
    const taken = await api().post(`/owner/support/${ticketId}/assign`).set(asOwner()).send({ assign: true }).expect(200);
    expect(taken.body.assignedTo).toBeNull(); // no platform user row behind the test token — attribution only
    const t = await db.supportTicket.findUnique({ where: { id: ticketId }, select: { assignedOwnerId: true } });
    expect(t?.assignedOwnerId).toBe(ownerSub);
    const ref = await api().patch(`/owner/support/${ticketId}`).set(asOwner()).send({ externalRef: '#412' }).expect(200);
    expect(ref.body.externalRef).toBe('#412');
    const mine = await api().get(`/manage/support/${ticketId}`).set(asSchool(adminOne, one.host)).expect(200);
    expect(mine.body.externalRef).toBeNull();
    const cleared = await api().patch(`/owner/support/${ticketId}`).set(asOwner()).send({ externalRef: null }).expect(200);
    expect(cleared.body.externalRef).toBeNull();
  });

  it('the school counts and list split open from closed, and the owner sees other schools on the same module', async () => {
    await raise(adminTwo, two.host, { title: 'Fee receipt shows wrong total' }, 0).expect(201);
    const counts = await api().get('/manage/support/counts').set(asSchool(adminOne, one.host)).expect(200);
    expect(counts.body).toMatchObject({ open: 1, closed: 0 });
    const detail = await api().get(`/owner/support/${ticketId}`).set(asOwner()).expect(200);
    expect(detail.body.sameModuleOpen).toBe(1);
    const closedList = await api().get('/manage/support').query({ status: 'CLOSED' }).set(asSchool(adminOne, one.host)).expect(200);
    expect(closedList.body).toEqual([]);
  });

  it('a resolved ticket left alone for over 7 days closes itself when the board is read, with a line saying so', async () => {
    const stale = await db.supportTicket.create({
      data: {
        schoolId: one.schoolId, raisedById: one.adminUserId, type: 'QUESTION', module: 'TIMETABLE', severity: 'ANNOYING',
        title: 'Friday shows twice', body: 'The timetable shows Friday twice.', status: 'RESOLVED', resolvedAt: new Date(Date.now() - 8 * DAY),
      },
      select: { id: true },
    });
    await api().get('/owner/support/board').set(asOwner()).expect(200);
    const after = await db.supportTicket.findUnique({ where: { id: stale.id }, select: { status: true, closedAt: true } });
    expect(after).toMatchObject({ status: 'CLOSED' });
    expect(after?.closedAt).not.toBeNull();
    const line = await db.supportTicketEntry.findFirst({ where: { ticketId: stale.id, authorKind: 'SYSTEM' } });
    expect(line?.body).toMatch(/Closed automatically/);
    expect(line).toMatchObject({ statusFrom: 'RESOLVED', statusTo: 'CLOSED', visibleToSchool: true });
  });

  it('a school is capped at 20 tickets a day', async () => {
    const have = await db.supportTicket.count({ where: { schoolId: two.schoolId, createdAt: { gte: new Date(Date.now() - DAY) } } });
    await db.supportTicket.createMany({
      data: Array.from({ length: Math.max(0, 20 - have) }, (_, i) => ({
        schoolId: two.schoolId, raisedById: two.adminUserId, type: 'IDEA', module: 'OTHER', severity: 'SUGGESTION',
        title: `Filler ${i}`, body: 'Filler to reach the daily cap.',
      })),
    });
    const res = await raise(adminTwo, two.host, { title: 'One too many' }, 0).expect(429);
    expect(res.body.code).toBe('SUPPORT_DAILY_LIMIT');
  });
});
