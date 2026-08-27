const txMock = {
  student: { findFirst: jest.fn(), update: jest.fn() },
  teacher: { findFirst: jest.fn(), update: jest.fn() },
  staff: { findFirst: jest.fn(), update: jest.fn() },
  mediaAsset: { create: jest.fn() },
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
// Spread the real module so re-exported Prisma enums survive (the tenancy
// barrel reads UserRole at import time) — see mistake ledger
// api-jest-db-mock-nukes-enums.
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { PhotoService, MAX_AVATAR_BYTES } from './photo.service';
import type { TenantContextService } from '../tenancy';
import type { StorageService } from '../../common/storage/storage.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'user-1';

function file(over: Partial<{ originalname: string; buffer: Buffer; mimetype: string }> = {}) {
  return { originalname: 'me.jpg', buffer: Buffer.from('img'), mimetype: 'image/jpeg', ...over };
}

describe('PhotoService', () => {
  const tenant = { requireTenant: () => ({ schoolId: SCHOOL }) } as unknown as TenantContextService;
  const storage = { upload: jest.fn() };
  const svc = new PhotoService(tenant, storage as unknown as StorageService);

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    storage.upload.mockResolvedValue({ key: 'schools/x/avatar/u-me.jpg', url: 'https://cdn/me.jpg' });
    txMock.mediaAsset.create.mockResolvedValue({ id: 'asset-1', url: 'https://cdn/me.jpg' });
    txMock.student.findFirst.mockResolvedValue(null);
    txMock.teacher.findFirst.mockResolvedValue(null);
    txMock.staff.findFirst.mockResolvedValue(null);
  });

  it('a STUDENT sets their own photo: uploads, creates an AVATAR asset, links photoAssetId', async () => {
    txMock.student.findFirst.mockResolvedValue({ id: 'stu-1' });

    const out = await svc.setOwn(USER, 'STUDENT', file());

    expect(out).toEqual({ assetId: 'asset-1', photoUrl: 'https://cdn/me.jpg' });
    expect(storage.upload).toHaveBeenCalledWith(
      `schools/${SCHOOL}/avatar`, 'me.jpg', expect.any(Buffer), 'image/jpeg',
    );
    expect(txMock.mediaAsset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ schoolId: SCHOOL, kind: 'AVATAR' }),
    });
    expect(txMock.student.update).toHaveBeenCalledWith({
      where: { id: 'stu-1' }, data: { photoAssetId: 'asset-1' },
    });
    // The person row is resolved from the JWT sub — never a client id.
    expect(txMock.student.findFirst).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL, userId: USER },
      select: { id: true },
    });
  });

  it('a TEACHER updates the teacher row; a STAFF the staff row', async () => {
    txMock.teacher.findFirst.mockResolvedValue({ id: 'tch-1' });
    await svc.setOwn(USER, 'TEACHER', file());
    expect(txMock.teacher.update).toHaveBeenCalledWith({ where: { id: 'tch-1' }, data: { photoAssetId: 'asset-1' } });
    expect(txMock.student.update).not.toHaveBeenCalled();

    txMock.staff.findFirst.mockResolvedValue({ id: 'stf-1' });
    await svc.setOwn(USER, 'STAFF', file());
    expect(txMock.staff.update).toHaveBeenCalledWith({ where: { id: 'stf-1' }, data: { photoAssetId: 'asset-1' } });
  });

  it('404 NO_PROFILE when the login has no person row (and for role SCHOOL_ADMIN)', async () => {
    await expect(svc.setOwn(USER, 'STUDENT', file())).rejects.toMatchObject({
      status: 404, response: { code: 'NO_PROFILE' },
    });
    await expect(svc.setOwn(USER, 'SCHOOL_ADMIN', file())).rejects.toMatchObject({
      status: 404, response: { code: 'NO_PROFILE' },
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects a missing file (400), a non-image (415) and an oversize image (413) before any upload', async () => {
    txMock.student.findFirst.mockResolvedValue({ id: 'stu-1' });
    await expect(svc.setOwn(USER, 'STUDENT', undefined)).rejects.toMatchObject({ response: { code: 'FILE_REQUIRED' } });
    await expect(svc.setOwn(USER, 'STUDENT', file({ mimetype: 'application/pdf' }))).rejects.toMatchObject({
      status: 415, response: { code: 'UNSUPPORTED_TYPE' },
    });
    await expect(
      svc.setOwn(USER, 'STUDENT', file({ buffer: Buffer.alloc(MAX_AVATAR_BYTES + 1) })),
    ).rejects.toMatchObject({ status: 413, response: { code: 'FILE_TOO_LARGE' } });
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
