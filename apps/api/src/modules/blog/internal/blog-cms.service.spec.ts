const txMock = {
  blogPost: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  schoolBlogSelection: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn(),
  },
  schoolProfile: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
};

const getPlatformPrismaMock = jest.fn(() => txMock);

// Keep the real `Prisma` export (prisma-errors.ts's isP2002 relies on
// `instanceof Prisma.PrismaClientKnownRequestError`); only getPlatformPrisma
// is stubbed so no real DB connection is ever attempted.
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  getPlatformPrisma: () => getPlatformPrismaMock(),
}));

import { ConflictException, NotFoundException } from '@nestjs/common';
import { BlogCmsService } from './blog-cms.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const POST = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('BlogCmsService.patchSelection — heroLimit enforcement', () => {
  const svc = new BlogCmsService();

  beforeEach(() => jest.clearAllMocks());

  it('rejects isHero:true once the school is already at its blogHeroLimit', async () => {
    txMock.schoolBlogSelection.findUnique.mockResolvedValue({
      id: 'sel-1',
      schoolId: SCHOOL,
      postId: POST,
      isHero: false,
      sortOrder: 0,
    });
    txMock.schoolProfile.findUnique.mockResolvedValue({ blogHeroLimit: 1 });
    txMock.schoolBlogSelection.count.mockResolvedValue(1); // already 1 hero, limit is 1

    await expect(svc.patchSelection(SCHOOL, POST, { isHero: true })).rejects.toThrow(ConflictException);
    expect(txMock.schoolBlogSelection.update).not.toHaveBeenCalled();
  });

  it('allows isHero:true when under the limit', async () => {
    txMock.schoolBlogSelection.findUnique.mockResolvedValue({
      id: 'sel-1',
      schoolId: SCHOOL,
      postId: POST,
      isHero: false,
      sortOrder: 0,
    });
    txMock.schoolProfile.findUnique.mockResolvedValue({ blogHeroLimit: 2 });
    txMock.schoolBlogSelection.count.mockResolvedValue(1); // 1 hero so far, limit is 2
    txMock.schoolBlogSelection.update.mockResolvedValue({ id: 'sel-1', isHero: true });

    await svc.patchSelection(SCHOOL, POST, { isHero: true });

    expect(txMock.schoolBlogSelection.update).toHaveBeenCalledWith({
      where: { id: 'sel-1' },
      data: { isHero: true },
    });
  });

  it('does not re-check the limit when the selection is already a hero (no-op flip)', async () => {
    txMock.schoolBlogSelection.findUnique.mockResolvedValue({
      id: 'sel-1',
      schoolId: SCHOOL,
      postId: POST,
      isHero: true,
      sortOrder: 0,
    });
    txMock.schoolBlogSelection.update.mockResolvedValue({ id: 'sel-1', isHero: true, sortOrder: 3 });

    await svc.patchSelection(SCHOOL, POST, { isHero: true, sortOrder: 3 });

    expect(txMock.schoolProfile.findUnique).not.toHaveBeenCalled();
    expect(txMock.schoolBlogSelection.update).toHaveBeenCalledWith({
      where: { id: 'sel-1' },
      data: { isHero: true, sortOrder: 3 },
    });
  });

  it('defaults the limit to 1 when the school has no profile row yet', async () => {
    txMock.schoolBlogSelection.findUnique.mockResolvedValue({
      id: 'sel-1',
      schoolId: SCHOOL,
      postId: POST,
      isHero: false,
      sortOrder: 0,
    });
    txMock.schoolProfile.findUnique.mockResolvedValue(null);
    txMock.schoolBlogSelection.count.mockResolvedValue(1);

    await expect(svc.patchSelection(SCHOOL, POST, { isHero: true })).rejects.toThrow(ConflictException);
  });
});

describe('BlogCmsService — tenant isolation (get/update/remove)', () => {
  const svc = new BlogCmsService();

  beforeEach(() => jest.clearAllMocks());

  it('get() throws NotFoundException for a post owned by another school', async () => {
    // The scoped where { id, schoolId } finds nothing for a foreign post,
    // regardless of whether a post with that id exists under another school.
    txMock.blogPost.findFirst.mockResolvedValue(null);

    await expect(svc.get(SCHOOL, POST)).rejects.toThrow(NotFoundException);
    expect(txMock.blogPost.findFirst).toHaveBeenCalledWith({ where: { id: POST, schoolId: SCHOOL } });
  });

  it('update() throws NotFoundException for a foreign post and never calls blogPost.update', async () => {
    txMock.blogPost.findFirst.mockResolvedValue(null);

    await expect(svc.update(SCHOOL, POST, { title: 'Hijacked title' })).rejects.toThrow(NotFoundException);
    expect(txMock.blogPost.update).not.toHaveBeenCalled();
  });

  it('remove() throws NotFoundException for a foreign post and never calls blogPost.delete', async () => {
    txMock.blogPost.findFirst.mockResolvedValue(null);

    await expect(svc.remove(SCHOOL, POST)).rejects.toThrow(NotFoundException);
    expect(txMock.blogPost.delete).not.toHaveBeenCalled();
  });
});

describe('BlogCmsService.addSelection — global-approval guard', () => {
  const svc = new BlogCmsService();

  beforeEach(() => jest.clearAllMocks());

  it('rejects a post that is not APPROVED-global and not own', async () => {
    // addSelection's lookup is scoped to { id, status: PUBLISHED, globalStatus:
    // APPROVED } — a post that is pending/rejected/draft (whether it's this
    // school's own or a foreign school's) simply fails to match and 404s,
    // rather than leaking whether the id exists at all.
    txMock.blogPost.findFirst.mockResolvedValue(null);

    await expect(svc.addSelection(SCHOOL, POST)).rejects.toThrow(NotFoundException);
    expect(txMock.blogPost.findFirst).toHaveBeenCalledWith({
      where: { id: POST, status: 'PUBLISHED', globalStatus: 'APPROVED' },
    });
    expect(txMock.schoolBlogSelection.create).not.toHaveBeenCalled();
  });
});
