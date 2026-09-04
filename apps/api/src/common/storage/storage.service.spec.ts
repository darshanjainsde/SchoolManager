const sendMock = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: sendMock })),
  PutObjectCommand: jest.fn().mockImplementation((i: unknown) => i),
  DeleteObjectCommand: jest.fn().mockImplementation((i: unknown) => i),
  GetObjectCommand: jest.fn().mockImplementation((i: unknown) => i),
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
