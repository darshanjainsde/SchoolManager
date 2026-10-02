import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from './store';

const cfg = {
  endpoint: 'https://example.storage.supabase.co/storage/v1/s3', region: 'ap-south-1', forcePathStyle: true,
  accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'public', privateBucket: 'private',
};

describe('a presigned upload URL is one a BROWSER can use', () => {
  it('signs no checksum of the (empty) body', async () => {
    // Newer AWS SDKs add `x-amz-checksum-crc32=AAAAAA==` — the checksum of an EMPTY
    // body — to a presigned PUT. The browser then sends the real file, storage sees a
    // body that does not match the checksum in the URL, and refuses it. The request
    // fails in the browser before our API ever hears about the upload.
    const url = new URL(await getSignedUrl(
      s3Client(cfg), new PutObjectCommand({ Bucket: 'private', Key: 'samples/uploads/x.sckools', ContentType: 'application/octet-stream' }),
      { expiresIn: 900 },
    ));
    const names = [...url.searchParams.keys()].map((k) => k.toLowerCase());
    expect(names.filter((k) => k.includes('checksum'))).toEqual([]);
  });

  it('is still a signed, expiring PUT to the right object', async () => {
    const url = new URL(await getSignedUrl(
      s3Client(cfg), new PutObjectCommand({ Bucket: 'private', Key: 'k/x.sckools' }), { expiresIn: 900 },
    ));
    expect(url.pathname).toBe('/storage/v1/s3/private/k/x.sckools');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });
});
