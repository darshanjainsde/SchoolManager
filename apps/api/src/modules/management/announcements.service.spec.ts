const txMock = {
  classSection: { findMany: jest.fn() },
  announcement: { create: jest.fn() },
  school: { findFirst: jest.fn() },
  student: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
};

jest.mock('@skoolos/db', () => ({
  withTenant: (_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

const recipientsMock = {
  resolveSectionRecipients: jest.fn(),
  resolveSchoolRecipients: jest.fn(),
};
jest.mock('../../common/notifications/recipients', () => ({
  resolveSectionRecipients: (...a: unknown[]) => recipientsMock.resolveSectionRecipients(...a),
  resolveSchoolRecipients: (...a: unknown[]) => recipientsMock.resolveSchoolRecipients(...a),
}));

import { AnnouncementsService } from './announcements.service';
import { istTodayISO } from '../../common/dates/timetable-date';
import type { NotificationService } from '../../common/notifications/notification.service';
import type { AttendanceService } from './attendance.service';
import type { CreateAnnouncementDto } from './management.dto';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLASS_A = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CLASS_B = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ADMIN = 'user-admin-1';

const flushBackgroundWork = () => new Promise((resolve) => setImmediate(resolve));
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe('AnnouncementsService — the kind of notice (topic)', () => {
  const notifications = { notify: jest.fn() };
  const attendance = { myClassSections: jest.fn() };
  const svc = new AnnouncementsService(notifications as unknown as NotificationService, attendance as unknown as AttendanceService);

  beforeEach(() => {
    jest.clearAllMocks();
    notifications.notify.mockResolvedValue({ sent: 0, failed: 0 });
    txMock.school.findFirst.mockResolvedValue({ name: 'Green Valley School' });
    txMock.classSection.findMany.mockResolvedValue([
      { id: CLASS_A, name: 'A', grade: { name: '5' } },
      { id: CLASS_B, name: 'B', grade: { name: '5' } },
    ]);
    txMock.announcement.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: `ann-${data.classSectionId}`, ...data }));
    recipientsMock.resolveSectionRecipients.mockImplementation(async (_tx: unknown, _s: string, id: string) => [`parent-${id === CLASS_A ? 'a' : 'b'}@x.test`]);
    recipientsMock.resolveSchoolRecipients.mockResolvedValue(['all@x.test']);
  });

  it('puts the formatted topic and each recipient\'s own className on every payload', async () => {
    const tomorrow = addDays(istTodayISO(), 1);
    const dto: CreateAnnouncementDto = {
      title: "Parents' meeting", body: 'Please come.', classSectionIds: [CLASS_A, CLASS_B],
      topic: { kind: 'PTM', on: tomorrow, at: '10:00' },
    };
    await svc.create(SCHOOL, ADMIN, 'SCHOOL_ADMIN', dto);
    await flushBackgroundWork();

    expect(notifications.notify).toHaveBeenCalledTimes(1);
    const [kind, recipients] = notifications.notify.mock.calls[0] as [string, Array<{ email: string; payload: Record<string, unknown> }>];
    expect(kind).toBe('ANNOUNCEMENT');
    expect(recipients).toHaveLength(2);
    const topic = expect.objectContaining({ kind: 'PTM', at: '10:00 am', on: expect.stringMatching(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} \d{4}$/) });
    expect(recipients.find((r) => r.email === 'parent-a@x.test')?.payload).toMatchObject({ className: '5-A', topic });
    expect(recipients.find((r) => r.email === 'parent-b@x.test')?.payload).toMatchObject({ className: '5-B', topic });
  });

  it('a whole-school notice carries the topic too', async () => {
    await svc.create(SCHOOL, ADMIN, 'SCHOOL_ADMIN', {
      title: 'Timings', body: 'Short day.', topic: { kind: 'TIMING', on: addDays(istTodayISO(), 2), from: '08:00', to: '12:30' },
    });
    await flushBackgroundWork();
    const recipients = notifications.notify.mock.calls[0][1] as Array<{ payload: Record<string, unknown> }>;
    expect(recipients[0].payload).toMatchObject({ className: null, topic: { kind: 'TIMING', from: '8:00 am', to: '12:30 pm' } });
  });

  it('a general notice carries topic: null', async () => {
    await svc.create(SCHOOL, ADMIN, 'SCHOOL_ADMIN', { title: 'Kit', body: 'White shoes.' });
    await flushBackgroundWork();
    const recipients = notifications.notify.mock.calls[0][1] as Array<{ payload: Record<string, unknown> }>;
    expect(recipients[0].payload.topic).toBeNull();
  });

  it('a past date is refused before any announcement is created', async () => {
    const dto: CreateAnnouncementDto = {
      title: 'PTM', body: 'Come.', classSectionIds: [CLASS_A],
      topic: { kind: 'PTM', on: addDays(istTodayISO(), -1), at: '10:00' },
    };
    await expect(svc.create(SCHOOL, ADMIN, 'SCHOOL_ADMIN', dto)).rejects.toMatchObject({ response: { code: 'VALIDATION', field: 'topic.on' } });
    expect(txMock.announcement.create).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
