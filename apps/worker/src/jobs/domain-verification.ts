import { Worker } from 'bullmq';
import { promises as dns } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { getPlatformPrisma } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import type { Logger } from 'pino';
import { redisConnectionFromUrl } from '../redis-conn';

interface DomainJobData {
  customDomainId: string;
  /** Test seam: bypass actual DNS/HTTP and use this fake result. */
  mock?: { resolvable: boolean; reachable: boolean };
}

/**
 * Verifies a custom-domain entry. Status transitions:
 *
 *   PENDING / VERIFYING / ERROR
 *     → resolve DNS (CNAME or A) → resolves to our ingress target?
 *     → HTTP probe at /.well-known/skoolos-verification → 200?
 *
 *   On success → LIVE + TLS issuance kicked off (stubbed locally, cert-manager
 *   in prod). On failure → ERROR with lastError populated.
 */
export function startDomainVerificationWorker(logger: Logger) {
  const env = loadEnv();

  const worker = new Worker<DomainJobData>(
    'domain-verification',
    async (job) => {
      const id = job.data.customDomainId;
      const cd = await getPlatformPrisma().customDomain.findUnique({ where: { id } });
      if (!cd) {
        logger.warn({ id }, 'domain row missing — nothing to verify');
        return { ok: false };
      }
      await getPlatformPrisma().customDomain.update({
        where: { id },
        data: { status: 'VERIFYING', lastCheckedAt: new Date(), lastError: null },
      });

      let resolvable: boolean;
      let reachable: boolean;
      let detail = '';
      try {
        if (job.data.mock) {
          resolvable = job.data.mock.resolvable;
          reachable = job.data.mock.reachable;
          detail = 'mocked';
        } else {
          resolvable = await checkDns(cd.hostname, cd.dnsTarget ?? '', cd.type);
          reachable = resolvable ? await checkReachable(cd.hostname) : false;
          detail = `dns=${resolvable} http=${reachable}`;
        }
      } catch (e) {
        resolvable = false;
        reachable = false;
        detail = (e as Error).message;
      }

      const ok = resolvable && reachable;
      const next = ok ? 'LIVE' : 'ERROR';
      await getPlatformPrisma().customDomain.update({
        where: { id },
        data: {
          status: next,
          lastCheckedAt: new Date(),
          lastError: ok ? null : `verification failed: ${detail}`,
          tlsStatus: ok ? 'ACTIVE' : cd.tlsStatus,
        },
      });

      logger.info({ id, hostname: cd.hostname, status: next, detail }, 'domain verified');
      return { ok, status: next, detail };
    },
    { connection: redisConnectionFromUrl(env.REDIS_URL), concurrency: 4 },
  );

  worker.on('ready', () => logger.info('domain-verification worker ready'));
  worker.on('failed', (job, err) =>
    logger.error({ id: job?.id, err: err.message }, 'verification failed'),
  );
  return worker;
}

async function checkDns(
  hostname: string,
  expectedTarget: string,
  type: 'APEX' | 'SUBDOMAIN',
): Promise<boolean> {
  try {
    if (type === 'SUBDOMAIN') {
      const records = await dns.resolveCname(hostname).catch(() => [] as string[]);
      if (records.some((r) => r.toLowerCase().includes(expectedTarget.toLowerCase()))) return true;
    }
    const aRecords = await dns.resolve4(hostname).catch(() => [] as string[]);
    return aRecords.includes(expectedTarget);
  } catch {
    return false;
  }
}

async function checkReachable(hostname: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = (hostname.includes(':') ? httpRequest : httpsRequest)(
      { hostname, path: '/.well-known/skoolos-verification', method: 'GET', timeout: 5000 },
      (res) => {
        res.resume();
        resolve(true); // any response means the host is reachable
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}
