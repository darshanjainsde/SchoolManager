import type { Request } from 'express';
import { Logger } from '@nestjs/common';

const logger = new Logger('SchoolBackups');

/**
 * Keeps a job moving after this request ends: one call to the drive endpoint
 * on this same API, as a NEW request (so a NEW function invocation with its
 * own 60 s). We only wait long enough for it to be accepted — the work runs
 * there, not here. Without CRON_SECRET there is no way to call it, so jobs
 * then advance only while the owner console is open and polling.
 */
export function continueInBackground(req: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? req.protocol ?? 'https';
  const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0] ?? req.headers.host;
  if (!host) return;
  const url = `${proto}://${host}/internal/cron/school-backups`;
  void fetch(url, { method: 'POST', headers: { 'x-cron-secret': secret }, signal: AbortSignal.timeout(1500) })
    .catch((e) => {
      // A timeout here is the normal case: the other request is busy working.
      if ((e as Error).name !== 'TimeoutError') logger.warn(`could not continue backups in the background: ${(e as Error).message}`);
    });
}
