const dbMock = {
  blogPost: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

const getPlatformPrismaMock = jest.fn(() => dbMock);

jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  getPlatformPrisma: () => getPlatformPrismaMock(),
}));

import { ConflictException, NotFoundException } from '@nestjs/common';
import { BlogOwnerService } from './blog-owner.service';

const POST_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('BlogOwnerService.approve — global slug collision', () => {
  const svc = new BlogOwnerService();

  beforeEach(() => jest.clearAllMocks());

  it('assigns globalSlug = slug when there is no collision', async () => {
    dbMock.blogPost.findUnique.mockResolvedValue({
      id: POST_ID,
      slug: 'why-students-forget',
      globalStatus: 'PENDING',
      school: { slug: 'beacon' },
    });
    dbMock.blogPost.findFirst.mockResolvedValue(null); // no clash
    dbMock.blogPost.update.mockResolvedValue({ id: POST_ID, globalSlug: 'why-students-forget' });

    await svc.approve(POST_ID);

    expect(dbMock.blogPost.update).toHaveBeenCalledWith({
      where: { id: POST_ID },
      data: { globalStatus: 'APPROVED', globalSlug: 'why-students-forget', rejectReason: null },
    });
  });

  it('suffixes with -<schoolSlug> when the bare slug is already taken by another post', async () => {
    dbMock.blogPost.findUnique.mockResolvedValue({
      id: POST_ID,
      slug: 'why-students-forget',
      globalStatus: 'PENDING',
      school: { slug: 'beacon' },
    });
    // First lookup (bare slug) clashes; second lookup (suffixed) is clear.
    dbMock.blogPost.findFirst
      .mockResolvedValueOnce({ id: 'other-post' })
      .mockResolvedValueOnce(null);
    dbMock.blogPost.update.mockResolvedValue({ id: POST_ID, globalSlug: 'why-students-forget-beacon' });

    await svc.approve(POST_ID);

    expect(dbMock.blogPost.update).toHaveBeenCalledWith({
      where: { id: POST_ID },
      data: { globalStatus: 'APPROVED', globalSlug: 'why-students-forget-beacon', rejectReason: null },
    });
  });

  it('throws ConflictException when even the suffixed slug collides', async () => {
    dbMock.blogPost.findUnique.mockResolvedValue({
      id: POST_ID,
      slug: 'why-students-forget',
      globalStatus: 'PENDING',
      school: { slug: 'beacon' },
    });
    dbMock.blogPost.findFirst
      .mockResolvedValueOnce({ id: 'other-post' })
      .mockResolvedValueOnce({ id: 'yet-another-post' });

    await expect(svc.approve(POST_ID)).rejects.toThrow(ConflictException);
    expect(dbMock.blogPost.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundException for an unknown post id', async () => {
    dbMock.blogPost.findUnique.mockResolvedValue(null);
    await expect(svc.approve(POST_ID)).rejects.toThrow(NotFoundException);
  });

  it('throws ConflictException when the post is not PENDING (e.g. already approved)', async () => {
    dbMock.blogPost.findUnique.mockResolvedValue({
      id: POST_ID,
      slug: 'why-students-forget',
      globalStatus: 'APPROVED',
      school: { slug: 'beacon' },
    });
    await expect(svc.approve(POST_ID)).rejects.toThrow(ConflictException);
  });
});

describe('BlogOwnerService.reject', () => {
  const svc = new BlogOwnerService();

  beforeEach(() => jest.clearAllMocks());

  it('sets REJECTED + rejectReason for a pending post', async () => {
    dbMock.blogPost.findUnique.mockResolvedValue({ id: POST_ID, globalStatus: 'PENDING' });
    dbMock.blogPost.update.mockResolvedValue({ id: POST_ID, globalStatus: 'REJECTED', rejectReason: 'not accurate' });

    await svc.reject(POST_ID, 'not accurate');

    expect(dbMock.blogPost.update).toHaveBeenCalledWith({
      where: { id: POST_ID },
      data: { globalStatus: 'REJECTED', rejectReason: 'not accurate' },
    });
  });

  it('throws ConflictException when the post is not PENDING', async () => {
    dbMock.blogPost.findUnique.mockResolvedValue({ id: POST_ID, globalStatus: 'REJECTED' });
    await expect(svc.reject(POST_ID, 'again')).rejects.toThrow(ConflictException);
  });
});
