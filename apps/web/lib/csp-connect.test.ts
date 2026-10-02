// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { connectSrc } from './csp-connect';

const STAGING_STORAGE = 'https://pnczxkyteaocpdoufwyz.storage.supabase.co';
const PROD_STORAGE = 'https://oljrqinbjhpysgfwmtxw.storage.supabase.co';

describe('what the browser may connect to', () => {
  it('lets the owner console upload a backup or a sample pack straight to storage', () => {
    // "Upload a pack" PUTs the file to a presigned storage URL FROM THE BROWSER.
    // With storage absent from connect-src the browser refuses the request before
    // it is sent — it never reaches storage, and the API never hears of the upload.
    // Shipped that way once: the button failed and the server logs showed nothing.
    for (const path of ['/platform', '/platform/sample-packs', '/platform/backups', '/platform/schools/abc']) {
      const src = connectSrc(path, false);
      expect([path, src.includes(STAGING_STORAGE)]).toEqual([path, true]);
      expect([path, src.includes(PROD_STORAGE)]).toEqual([path, true]);
    }
  });

  it('gives no other page that permission — a school, a portal, a parent', () => {
    for (const path of ['/', '/app', '/portal', '/teacher', '/library', '/login', '/s/some-school', '/platformx']) {
      expect([path, connectSrc(path, false).includes('storage.supabase.co')]).toEqual([path, false]);
    }
  });

  it('never opens a wildcard — an attacker-controlled project must not be a place to send data', () => {
    expect(connectSrc('/platform/sample-packs', false)).not.toMatch(/\*/);
  });

  it('keeps the API origins every page already needs', () => {
    expect(connectSrc('/', false)).toContain("'self'");
    expect(connectSrc('/', false)).toContain('https://api.test.sckools.com');
    expect(connectSrc('/', false)).toContain('https://api.sckools.com');
  });

  it('allows local object storage only in development', () => {
    expect(connectSrc('/platform', true)).toContain('http://localhost:9000');
    expect(connectSrc('/platform', false)).not.toContain('http://localhost:9000');
  });
});
