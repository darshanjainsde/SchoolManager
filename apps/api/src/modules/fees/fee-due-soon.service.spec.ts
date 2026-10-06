const db = {
  feeInvoice: { findMany: jest.fn() },
  school: { findMany: jest.fn() },
  featureOverride: { findMany: jest.fn() },
  notification: { create: jest.fn() },
  notificationOutbox: { create: jest.fn() },
};

jest.mock('@skoolos/db', () => ({
  getPlatformPrisma: () => db,
  resolveFeatures: () => new Set(['FEES']),
}));
jest.mock('../../common/notifications/outbox-signal');
jest.mock('../../common/dates/timetable-date', () => ({
  ...jest.requireActual('../../common/dates/timetable-date'),
  istTodayISO: () => '2026-09-08',
}));

import { FeeDueSoonService } from './fee-due-soon.service';
import { requestOutboxDrain } from '../../common/notifications/outbox-signal';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('FeeDueSoonService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.school.findMany.mockResolvedValue([{ id: SCHOOL, name: 'Raffles Public School', tier: 'PRO' }]);
    db.featureOverride.findMany.mockResolvedValue([]);
    db.notification.create.mockResolvedValue({});
    db.notificationOutbox.create.mockResolvedValue({});
  });

  it('the week-ahead reminder names a September due date as "15 Sep 2026", never "Sept", and the outbox row carries the term and date', async () => {
    db.feeInvoice.findMany.mockResolvedValue([
      {
        id: 'inv-1',
        schoolId: SCHOOL,
        dueDate: new Date('2026-09-15T00:00:00.000Z'),
        totalMinor: 1_200_000,
        allocations: [],
        term: { name: 'Term 2' },
        student: { userId: 'u-1', firstName: 'Aarav' },
      },
    ]);

    const r = await new FeeDueSoonService().run();

    expect(r).toEqual({ schools: 1, notices: 1 });
    const payload = db.notificationOutbox.create.mock.calls[0][0].data.payload;
    expect(payload.body).toBe('Due Tue 15 Sep 2026. Pay from the Fees page whenever suits.');
    expect(payload.body).not.toMatch(/Sept/);
    expect(payload).toMatchObject({ termName: 'Term 2', dueOn: 'Tue 15 Sep 2026' });
    expect(db.notification.create.mock.calls[0][0].data.body).toBe(payload.body);
    expect(requestOutboxDrain).toHaveBeenCalledTimes(1);
  });
});
