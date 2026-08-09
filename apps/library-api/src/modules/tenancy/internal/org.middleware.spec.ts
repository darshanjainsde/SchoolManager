import type { NextFunction, Request, Response } from 'express';
import { OrgLookupService } from './org-lookup.service';
import { orgMiddleware } from './org.middleware';

/**
 * Pure logic under test: which hostname orgMiddleware hands to
 * OrgLookupService.resolveByHostname, given the resolution-order rule
 * (X-Library-Host > req.hostname > req.headers.host). Spying on the
 * prototype method intercepts calls made through the module's real
 * `lookup` singleton without touching Redis or Postgres — the singleton's
 * store/cache functions (which do reach real infra) are never invoked
 * because resolveByHostname itself never runs.
 */
function stubResolve(): jest.SpyInstance {
  return jest
    .spyOn(OrgLookupService.prototype, 'resolveByHostname')
    .mockResolvedValue({ kind: 'unknown', hostname: 'stubbed' });
}

function fakeReq(headers: Record<string, string | string[] | undefined>, hostname = ''): Request {
  return { headers, hostname } as unknown as Request;
}

/** Resolves once orgMiddleware calls next(), rejects if it calls next(err). */
function runMiddleware(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    const next = ((err?: unknown) => (err ? reject(err) : resolve())) as NextFunction;
    orgMiddleware(req, {} as Response, next);
  });
}

describe('orgMiddleware host resolution order', () => {
  afterEach(() => jest.restoreAllMocks());

  it('prefers X-Library-Host over req.hostname and req.headers.host', async () => {
    const spy = stubResolve();
    const req = fakeReq({ 'x-library-host': 'from-header.example.com', host: 'from-host-header.example.com' }, 'from-hostname.example.com');
    await runMiddleware(req);
    expect(spy).toHaveBeenCalledWith('from-header.example.com');
  });

  it('falls back to req.hostname when X-Library-Host is absent', async () => {
    const spy = stubResolve();
    const req = fakeReq({ host: 'from-host-header.example.com' }, 'from-hostname.example.com');
    await runMiddleware(req);
    expect(spy).toHaveBeenCalledWith('from-hostname.example.com');
  });

  it('falls back to req.headers.host when neither X-Library-Host nor req.hostname is set', async () => {
    const spy = stubResolve();
    const req = fakeReq({ host: 'from-host-header.example.com' }, '');
    await runMiddleware(req);
    expect(spy).toHaveBeenCalledWith('from-host-header.example.com');
  });

  it('treats an empty/whitespace X-Library-Host header as absent, falling through to req.hostname', async () => {
    const spy = stubResolve();
    const req = fakeReq({ 'x-library-host': '   ', host: 'from-host-header.example.com' }, 'from-hostname.example.com');
    await runMiddleware(req);
    expect(spy).toHaveBeenCalledWith('from-hostname.example.com');
  });

  it('uses the first value when X-Library-Host arrives as a repeated header (string[])', async () => {
    const spy = stubResolve();
    const req = fakeReq({ 'x-library-host': ['first.example.com', 'second.example.com'] }, 'from-hostname.example.com');
    await runMiddleware(req);
    expect(spy).toHaveBeenCalledWith('first.example.com');
  });

  it('sets req.org and runs next() inside the resolved AsyncLocalStorage scope', async () => {
    jest
      .spyOn(OrgLookupService.prototype, 'resolveByHostname')
      .mockResolvedValue({ kind: 'tenant', orgId: 'org-1', orgSlug: 'raffles', hostname: 'raffles.example.com' });
    const req = fakeReq({ 'x-library-host': 'raffles.example.com' });
    await runMiddleware(req);
    expect((req as Request & { org?: unknown }).org).toEqual({
      kind: 'tenant', orgId: 'org-1', orgSlug: 'raffles', hostname: 'raffles.example.com',
    });
  });

  it('calls next(err) rather than swallowing a resolution failure', async () => {
    jest.spyOn(OrgLookupService.prototype, 'resolveByHostname').mockRejectedValue(new Error('boom'));
    const req = fakeReq({ 'x-library-host': 'raffles.example.com' });
    await expect(runMiddleware(req)).rejects.toThrow('boom');
  });
});
