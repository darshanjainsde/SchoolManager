import { NotificationService } from './notification.service';
import type {
  AbsenceNoticePayload,
  NotificationChannel,
  ResultsPublishedPayload,
  TestReminderPayload,
  TestScheduledPayload,
} from './notification.types';

function fakeChannel(name: string): NotificationChannel {
  return { name, send: jest.fn() };
}

const scheduled: TestScheduledPayload = {
  schoolName: 'Green Valley School',
  subjectName: 'Mathematics',
  examTitle: 'Unit Test 1',
  scheduledAt: '2026-08-01T09:00:00.000Z',
};

const reminder: TestReminderPayload = { ...scheduled, daysUntil: 2 };

const results: ResultsPublishedPayload = {
  schoolName: 'Green Valley School',
  subjectName: 'Mathematics',
  examTitle: 'Unit Test 1',
};

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('NotificationService', () => {
  it('fans out to every configured channel for every recipient, tallying sent/failed', async () => {
    const email = fakeChannel('email');
    const whatsapp = fakeChannel('whatsapp');
    (email.send as jest.Mock).mockResolvedValue(true);
    (whatsapp.send as jest.Mock).mockResolvedValue(false);

    const svc = new NotificationService([email, whatsapp]);
    const result = await svc.notify('TEST_SCHEDULED', [
      { email: 'a@x.com', schoolId: SCHOOL, payload: scheduled },
      { email: 'b@x.com', schoolId: SCHOOL, payload: scheduled },
    ]);

    expect(result).toEqual({ sent: 2, failed: 2 });
    expect(email.send).toHaveBeenCalledTimes(2);
    expect(email.send).toHaveBeenCalledWith(
      'a@x.com',
      {
        kind: 'TEST_SCHEDULED',
        payload: scheduled,
      },
      SCHOOL,
    );
    expect(email.send).toHaveBeenCalledWith(
      'b@x.com',
      {
        kind: 'TEST_SCHEDULED',
        payload: scheduled,
      },
      SCHOOL,
    );
    expect(whatsapp.send).toHaveBeenCalledTimes(2);
  });

  /**
   * Regression net for N1 (cross-tenant push leak): `NotificationService`
   * must forward each recipient's OWN `schoolId` to the channel, not drop it
   * — a channel like `PushChannel` relies on this to avoid a tenant-blind
   * device lookup.
   */
  it('forwards each recipient\'s own schoolId to the channel as a third argument', async () => {
    const push = fakeChannel('push');
    (push.send as jest.Mock).mockResolvedValue(true);
    const SCHOOL_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    const svc = new NotificationService([push]);
    await svc.notify('TEST_SCHEDULED', [
      { email: 'a@school-a.com', schoolId: SCHOOL, payload: scheduled },
      { email: 'b@school-b.com', schoolId: SCHOOL_B, payload: scheduled },
    ]);

    expect(push.send).toHaveBeenNthCalledWith(
      1,
      'a@school-a.com',
      { kind: 'TEST_SCHEDULED', payload: scheduled },
      SCHOOL,
    );
    expect(push.send).toHaveBeenNthCalledWith(
      2,
      'b@school-b.com',
      { kind: 'TEST_SCHEDULED', payload: scheduled },
      SCHOOL_B,
    );
  });

  it('delivers each recipient THEIR OWN payload, so an absence notice names the right child', async () => {
    const email = fakeChannel('email');
    (email.send as jest.Mock).mockResolvedValue(true);

    const aisha: AbsenceNoticePayload = {
      schoolName: 'Green Valley School',
      studentName: 'Aisha Khan',
      date: '2026-07-21',
    };
    const rohan: AbsenceNoticePayload = {
      schoolName: 'Green Valley School',
      studentName: 'Rohan Mehta',
      date: '2026-07-21',
    };

    const svc = new NotificationService([email]);
    const result = await svc.notify('ABSENCE_NOTICE', [
      { email: 'aisha.parent@x.com', schoolId: SCHOOL, payload: aisha },
      { email: 'rohan.parent@x.com', schoolId: SCHOOL, payload: rohan },
    ]);

    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(email.send).toHaveBeenNthCalledWith(
      1,
      'aisha.parent@x.com',
      {
        kind: 'ABSENCE_NOTICE',
        payload: aisha,
      },
      SCHOOL,
    );
    expect(email.send).toHaveBeenNthCalledWith(
      2,
      'rohan.parent@x.com',
      {
        kind: 'ABSENCE_NOTICE',
        payload: rohan,
      },
      SCHOOL,
    );
  });

  it('does not throw when a channel rejects, and still tallies the other channels correctly', async () => {
    const email = fakeChannel('email');
    const broken = fakeChannel('broken');
    (email.send as jest.Mock).mockResolvedValue(true);
    (broken.send as jest.Mock).mockRejectedValue(new Error('boom'));

    const svc = new NotificationService([email, broken]);

    await expect(
      svc.notify('ABSENCE_NOTICE', [
        {
          email: 'parent@x.com',
          schoolId: SCHOOL,
          payload: { schoolName: 'S', studentName: 'A', date: '2026-07-21' },
        },
      ]),
    ).resolves.toEqual({ sent: 1, failed: 1 });
  });

  it('does not throw when a channel resolves false, tallying it as failed', async () => {
    const email = fakeChannel('email');
    (email.send as jest.Mock).mockResolvedValue(false);

    const svc = new NotificationService([email]);

    await expect(
      svc.notify('RESULTS_PUBLISHED', [{ email: 'x@y.com', schoolId: SCHOOL, payload: results }]),
    ).resolves.toEqual({ sent: 0, failed: 1 });
  });

  it('returns sent:0,failed:0 and calls no channel for an empty recipient list', async () => {
    const email = fakeChannel('email');
    const svc = new NotificationService([email]);

    const result = await svc.notify('TEST_REMINDER', []);

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(email.send).not.toHaveBeenCalled();
  });

  it('restricts delivery to the named channels when onlyChannels is given', async () => {
    const email = fakeChannel('email');
    const push = fakeChannel('push');
    (email.send as jest.Mock).mockResolvedValue(true);
    (push.send as jest.Mock).mockResolvedValue(true);

    const svc = new NotificationService([email, push]);
    const result = await svc.notify(
      'TEST_SCHEDULED',
      [{ email: 'a@x.com', schoolId: SCHOOL, payload: scheduled }],
      ['email'],
    );

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(push.send).not.toHaveBeenCalled();
  });

  it('falls back to every configured channel when onlyChannels is omitted (unchanged default)', async () => {
    const email = fakeChannel('email');
    const push = fakeChannel('push');
    (email.send as jest.Mock).mockResolvedValue(true);
    (push.send as jest.Mock).mockResolvedValue(true);

    const svc = new NotificationService([email, push]);
    await svc.notify('TEST_SCHEDULED', [{ email: 'a@x.com', schoolId: SCHOOL, payload: scheduled }]);

    expect(email.send).toHaveBeenCalledTimes(1);
    expect(push.send).toHaveBeenCalledTimes(1);
  });

  it('hands the channel a discriminated message whose kind matches the payload it carries', async () => {
    const email = fakeChannel('email');
    (email.send as jest.Mock).mockResolvedValue(true);

    const svc = new NotificationService([email]);
    await svc.notify('TEST_REMINDER', [{ email: 'p@x.com', schoolId: SCHOOL, payload: reminder }]);

    expect(email.send).toHaveBeenCalledWith(
      'p@x.com',
      {
        kind: 'TEST_REMINDER',
        payload: reminder,
      },
      SCHOOL,
    );
  });
});
