import 'reflect-metadata';

const txMock = {
  jobPost: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  jobQuestion: { createMany: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn() },
  jobApplication: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
};
const platformMock = {
  jobPost: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  jobApplication: { create: jest.fn() },
  jobQuestion: { findMany: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
  getPlatformPrisma: () => platformMock,
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JobsService } from './jobs.service';

/**
 * THE GUARDS THAT PROTECT PEOPLE, NOT THE CRUD.
 *
 * Hiring stores the most sensitive data in this product: a private
 * individual's name, phone and CV link, submitted by somebody with no account.
 * Two properties matter more than every other behaviour here:
 *
 *   1. An application is filed against the school that OWNS THE VACANCY —
 *      never a school named by the request. sckools.com has no tenant context,
 *      so this write happens on the platform connection with RLS bypassed; the
 *      vacancy lookup IS the guard, and it has to be tested like one.
 *   2. A vacancy that is not APPROVED cannot be applied to at all.
 *
 * Plus the product rule that keeps the desk usable: four questions maximum,
 * enforced here rather than only in the builder a determined caller can skip.
 */

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_SCHOOL = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const JOB = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const tenant = { requireTenant: () => ({ schoolId: SCHOOL }) } as never;
const svc = new JobsService(tenant);

const APPLICANT = {
  name: 'Meera Rao',
  email: 'meera@example.com',
  phone: '9876543210',
  cvUrl: 'https://drive.example.com/cv',
};

beforeEach(() => {
  jest.clearAllMocks();
  platformMock.jobPost.findFirst.mockResolvedValue({ id: JOB, schoolId: OTHER_SCHOOL, status: 'APPROVED' });
  platformMock.jobQuestion.findMany.mockResolvedValue([]);
  platformMock.jobApplication.create.mockImplementation((args: { data: Record<string, unknown> }) => ({
    id: 'app-1',
    ...args.data,
  }));
  txMock.jobPost.findFirst.mockResolvedValue({ id: JOB, schoolId: SCHOOL, status: 'DRAFT' });
  txMock.jobPost.create.mockImplementation((args: { data: Record<string, unknown> }) => ({ id: JOB, ...args.data }));
  txMock.jobPost.update.mockImplementation((args: { data: Record<string, unknown> }) => ({ id: JOB, ...args.data }));
});

describe('a stranger applying from sckools.com', () => {
  it('is filed against the school that posted the vacancy, not one it names', async () => {
    // The request cannot influence this: schoolId comes from the vacancy row.
    await svc.apply(JOB, { ...APPLICANT, schoolId: SCHOOL } as never);
    const { data } = platformMock.jobApplication.create.mock.calls[0][0];
    expect(data.schoolId).toBe(OTHER_SCHOOL);
    expect(data.jobPostId).toBe(JOB);
  });

  it('keeps what the candidate actually wrote', async () => {
    await svc.apply(JOB, APPLICANT);
    const { data } = platformMock.jobApplication.create.mock.calls[0][0];
    expect(data).toMatchObject({ name: 'Meera Rao', email: 'meera@example.com', cvUrl: 'https://drive.example.com/cv' });
    expect(data.status).toBe('NEW');
  });

  it('cannot apply to a vacancy that is not approved', async () => {
    for (const status of ['DRAFT', 'PENDING', 'REJECTED', 'CLOSED']) {
      platformMock.jobPost.findFirst.mockResolvedValue({ id: JOB, schoolId: OTHER_SCHOOL, status });
      await expect(svc.apply(JOB, APPLICANT)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(platformMock.jobApplication.create).not.toHaveBeenCalled();
  });

  it('gets a not-found for a vacancy that does not exist, not a silent success', async () => {
    platformMock.jobPost.findFirst.mockResolvedValue(null);
    await expect(svc.apply(JOB, APPLICANT)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps only answers to questions the vacancy actually asked', async () => {
    // Otherwise the answers blob is an unbounded write from a public endpoint.
    platformMock.jobQuestion.findMany.mockResolvedValue([{ id: 'q1', kind: 'YES_NO' }]);
    await svc.apply(JOB, { ...APPLICANT, answers: { q1: true, 'not-a-question': 'junk' } });
    const { data } = platformMock.jobApplication.create.mock.calls[0][0];
    expect(data.answers).toEqual({ q1: true });
  });
});

describe('the four-question cap', () => {
  it('refuses a fifth question, in the service and not only in the builder', async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ prompt: `Q${i}`, kind: 'TEXT' as const, options: [], required: false }));
    await expect(svc.create({ title: 'Teacher', summary: 's', description: 'd', questions: five } as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('accepts four', async () => {
    const four = Array.from({ length: 4 }, (_, i) => ({ prompt: `Q${i}`, kind: 'TEXT' as const, options: [], required: false }));
    await expect(
      svc.create({ title: 'Teacher', summary: 's', description: 'd', questions: four } as never),
    ).resolves.toBeDefined();
  });
});

describe('the status machine the owner shares with the school', () => {
  it('creates a vacancy as a DRAFT — nothing goes public by being typed', async () => {
    await svc.create({ title: 'Teacher', summary: 's', description: 'd', questions: [] } as never);
    expect(txMock.jobPost.create.mock.calls[0][0].data.status).toBe('DRAFT');
  });

  it('submits a draft for the owner to review', async () => {
    await svc.submit(JOB);
    expect(txMock.jobPost.update.mock.calls[0][0].data.status).toBe('PENDING');
  });

  it('sends an edited APPROVED vacancy back for review', async () => {
    // Otherwise an admin edits an approved post and pushes arbitrary content
    // live on the owner's own site with no second look.
    txMock.jobPost.findFirst.mockResolvedValue({ id: JOB, schoolId: SCHOOL, status: 'APPROVED' });
    await svc.update(JOB, { title: 'Something else' } as never);
    expect(txMock.jobPost.update.mock.calls[0][0].data.status).toBe('PENDING');
  });

  it('leaves a draft a draft when it is edited', async () => {
    await svc.update(JOB, { title: 'Still working on it' } as never);
    expect(txMock.jobPost.update.mock.calls[0][0].data.status).toBeUndefined();
  });

  it('makes the owner give a reason when refusing', async () => {
    await expect(svc.moderate(JOB, { decision: 'REJECT' } as never)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('what the public board is allowed to see', () => {
  it('lists only approved vacancies', async () => {
    platformMock.jobPost.findMany.mockResolvedValue([]);
    await svc.publicBoard({});
    expect(platformMock.jobPost.findMany.mock.calls[0][0].where).toMatchObject({ status: 'APPROVED' });
  });

  it('never selects an applicant field on the public path', async () => {
    // The board and the vacancy page must not be able to leak a candidate.
    platformMock.jobPost.findMany.mockResolvedValue([]);
    await svc.publicBoard({});
    const args = JSON.stringify(platformMock.jobPost.findMany.mock.calls[0][0]);
    expect(args).not.toMatch(/application/i);
  });
});
