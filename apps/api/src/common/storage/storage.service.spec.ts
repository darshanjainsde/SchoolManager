const sendMock = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: sendMock })),
  PutObjectCommand: jest.fn().mockImplementation((i: unknown) => i),
  DeleteObjectCommand: jest.fn().mockImplementation((i: unknown) => i),
  GetObjectCommand: jest.fn().mockImplementation((i: unknown) => i),
  ListObjectsV2Command: jest.fn().mockImplementation((i: unknown) => ({ list: i })),
  DeleteObjectsCommand: jest.fn().mockImplementation((i: unknown) => ({ del: i })),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));

import { StorageService } from './storage.service';

/**
 * A dead object store must say so. Staging's Supabase project was deleted and
 * every upload answered a generic 500 "Something went wrong" — which reads to
 * the person holding the file as "your file is bad", so they retried forever.
 */
describe('StorageService.upload — when the store is gone', () => {
  beforeEach(() => jest.clearAllMocks());

  it('answers a typed 503 that names the real problem, not a generic 500', async () => {
    const gone = Object.assign(new Error('deserialization'), { $metadata: { httpStatusCode: 410 } });
    sendMock.mockRejectedValue(gone);

    const svc = new StorageService();
    await expect(svc.upload('print-orders/x', 'paper.pdf', Buffer.from('%PDF'), 'application/pdf'))
      .rejects.toMatchObject({
        status: 503,
        response: { code: 'STORAGE_UNAVAILABLE', field: 'file' },
      });
  });

  it('returns the key and url when the store accepts the write', async () => {
    sendMock.mockResolvedValue({});
    const svc = new StorageService();
    const out = await svc.upload('print-orders/x', 'my paper.pdf', Buffer.from('%PDF'), 'application/pdf');
    expect(out.key).toMatch(/^print-orders\/x\/[0-9a-f-]+-my_paper\.pdf$/);
    expect(out.url).toContain(out.key);
  });
});

/**
 * Deleting a school empties its folder. The folder must name ONE school —
 * a looser prefix would empty the bucket for every school.
 */
describe('StorageService.deletePrefix — one school folder, all of it', () => {
  beforeEach(() => jest.clearAllMocks());
  const ID = '834652cc-876d-417a-b3cf-498b46d2320f';

  it('refuses any prefix that is not exactly <area>/<uuid>/', async () => {
    const svc = new StorageService();
    for (const bad of ['schools/', '', 'schools', `schools/${ID}`, 'schools/abc/', `schools/${ID}/logo/`]) {
      await expect(svc.deletePrefix(bad)).rejects.toThrow(/refuses/);
    }
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('pages through the listing and deletes every key it finds', async () => {
    sendMock.mockImplementation(async (cmd: { list?: { ContinuationToken?: string }; del?: unknown }) => {
      if (cmd.list) {
        return cmd.list.ContinuationToken
          ? { Contents: [{ Key: `schools/${ID}/fees/c.pdf` }], IsTruncated: false }
          : { Contents: [{ Key: `schools/${ID}/logo/a.png` }, { Key: `schools/${ID}/gifts/b.jpg` }], IsTruncated: true, NextContinuationToken: 't2' };
      }
      return {};
    });
    const svc = new StorageService();
    const n = await svc.deletePrefix(`schools/${ID}/`);
    const deleted = sendMock.mock.calls.filter(([c]) => c.del).flatMap(([c]) => c.del.Delete.Objects.map((o: { Key: string }) => o.Key));
    expect(deleted).toEqual([`schools/${ID}/logo/a.png`, `schools/${ID}/gifts/b.jpg`, `schools/${ID}/fees/c.pdf`]);
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it('never throws when the store fails — the database delete has already committed', async () => {
    sendMock.mockRejectedValue(new Error('network'));
    await expect(new StorageService().deletePrefix(`schools/${ID}/`)).resolves.toBe(0);
  });
});
