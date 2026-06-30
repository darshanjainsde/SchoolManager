import { Worker } from 'bullmq';
import nodemailer from 'nodemailer';
import { getPlatformPrisma, UserRole } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import type { Logger } from 'pino';
import { redisConnectionFromUrl } from '../redis-conn';

interface ProvisioningJobData {
  schoolId: string;
  adminUserId: string;
  adminEmail: string;
  adminFirstName: string;
  inviteToken: string;
  initialTeachers: Array<{ email: string; firstName: string; lastName: string }>;
  initialStudents: Array<{ email: string; firstName: string; lastName: string }>;
}

const env = loadEnv();
const smtp = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false,
  ignoreTLS: true,
});

export function startProvisioningWorker(logger: Logger) {
  const worker = new Worker<ProvisioningJobData>(
    'school-provisioning',
    async (job) => {
      const data = job.data;
      logger.info({ schoolId: data.schoolId }, 'provisioning school');

      // 1. Bulk-create initial users with placeholder passwords. Real password
      //    is set when they accept their invite (Phase 6+).
      const placeholderHash = await import('argon2').then((m) =>
        m.hash('temp-' + Math.random().toString(36).slice(2), { type: m.argon2id }),
      );
      const all = [
        ...data.initialTeachers.map((u) => ({ ...u, role: UserRole.TEACHER })),
        ...data.initialStudents.map((u) => ({ ...u, role: UserRole.STUDENT })),
      ];
      for (const u of all) {
        await getPlatformPrisma()
          .user.create({
            data: {
              schoolId: data.schoolId,
              email: u.email.toLowerCase(),
              firstName: u.firstName,
              lastName: u.lastName,
              role: u.role,
              passwordHash: placeholderHash,
              isActive: true,
            },
          })
          .catch((e: Error) => logger.warn({ err: e.message }, 'skipping duplicate import row'));
      }

      // 2. Send the school-admin invite email. MailHog captures locally.
      const school = await getPlatformPrisma().school.findUnique({
        where: { id: data.schoolId },
      });
      const inviteUrl = `http://${school?.slug}.${env.PLATFORM_HOST}:${env.WEB_PORT}/accept-invite?token=${data.inviteToken}&u=${data.adminUserId}`;
      await smtp.sendMail({
        from: env.SMTP_FROM,
        to: data.adminEmail,
        subject: `You're invited as administrator of ${school?.name ?? 'a new school'} on SkoolOS`,
        text: `Hi ${data.adminFirstName},

You've been invited to administer ${school?.name ?? ''} on SkoolOS.

Set your password and log in here:
${inviteUrl}

This is a one-time link tied to your account.

— SkoolOS`,
      });

      logger.info({ schoolId: data.schoolId, importedUsers: all.length }, 'provisioning done');
      return { ok: true, importedUsers: all.length };
    },
    { connection: redisConnectionFromUrl(env.REDIS_URL), concurrency: 4 },
  );

  worker.on('ready', () => logger.info('school-provisioning worker ready'));
  worker.on('failed', (job, err) =>
    logger.error({ id: job?.id, err: err.message }, 'provisioning failed'),
  );
  return worker;
}
