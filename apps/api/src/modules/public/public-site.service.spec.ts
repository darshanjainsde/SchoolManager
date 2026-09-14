import 'reflect-metadata';

const txMock = {
  school: { findUnique: jest.fn() },
  schoolProfile: { findUnique: jest.fn() },
  homepageContent: { findUnique: jest.fn() },
  statItem: { findMany: jest.fn() },
  socialLink: { findMany: jest.fn() },
  mediaAsset: { findMany: jest.fn() },
  featuredStaff: { findMany: jest.fn() },
  course: { findMany: jest.fn() },
  admissionStep: { findMany: jest.fn() },
  admissionsSettings: { findUnique: jest.fn() },
  schoolPage: { findMany: jest.fn() },
  designDraft: { findFirst: jest.fn() },
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));
jest.mock('@skoolos/config', () => ({ loadEnv: () => ({}) }));
// The Hall of Fame read runs its own transaction against tables this spec
// does not model; null is exactly what a school without one gets.
jest.mock('../cms', () => ({
  ...jest.requireActual('../cms'),
  readHallOfFame: jest.fn().mockResolvedValue(null),
}));

import { PublicSiteService } from './public-site.service';
import type { TenantContextService } from '../tenancy';
import type { FeatureResolverService } from '../features';
import type { PublicEventsService } from '../community';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeSvc() {
  const tenant = { get: () => ({ kind: 'tenant', schoolId: SCHOOL, hostname: 'raffles.test', schoolSlug: 'raffles' }) };
  const features = { getFeatures: jest.fn().mockResolvedValue(new Set(['PUBLIC_SITE', 'GALLERY'])) };
  const publicEvents = { listForSite: jest.fn().mockResolvedValue([]), list: jest.fn().mockResolvedValue([]) };
  return new PublicSiteService(
    tenant as unknown as TenantContextService,
    features as unknown as FeatureResolverService,
    publicEvents as unknown as PublicEventsService,
  );
}

describe('PublicSiteService.getSite — the Educators band (Active Roster)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.school.findUnique.mockResolvedValue({
      id: SCHOOL, name: 'Raffles Public School', slug: 'raffles', tier: 'PRO', status: 'LIVE', timezone: 'Asia/Kolkata',
    });
    txMock.schoolProfile.findUnique.mockResolvedValue(null);
    txMock.homepageContent.findUnique.mockResolvedValue(null);
    txMock.statItem.findMany.mockResolvedValue([]);
    txMock.socialLink.findMany.mockResolvedValue([]);
    txMock.mediaAsset.findMany.mockResolvedValue([]);
    txMock.featuredStaff.findMany.mockResolvedValue([]);
    txMock.course.findMany.mockResolvedValue([]);
    txMock.admissionStep.findMany.mockResolvedValue([]);
    txMock.admissionsSettings.findUnique.mockResolvedValue(null);
    txMock.schoolPage.findMany.mockResolvedValue([]);
    txMock.designDraft.findFirst.mockResolvedValue(null);
  });

  it('only asks for featured staff whose linked teacher is still ACTIVE (or who were never linked)', async () => {
    await makeSvc().getSite();

    expect(txMock.featuredStaff.findMany).toHaveBeenCalledTimes(1);
    expect(txMock.featuredStaff.findMany.mock.calls[0][0].where).toEqual({
      schoolId: SCHOOL,
      OR: [{ teacherId: null }, { teacher: { status: 'ACTIVE' } }],
    });
  });

  it('projects the rows the query returns onto the staff band', async () => {
    txMock.featuredStaff.findMany.mockResolvedValue([
      { name: 'Priya Iyer', role: 'Maths', photoAssetId: null, order: 0, teacherId: null },
    ]);
    const site = await makeSvc().getSite();
    expect(site.staff).toEqual([{ name: 'Priya Iyer', role: 'Maths', photoUrl: null }]);
  });
});
