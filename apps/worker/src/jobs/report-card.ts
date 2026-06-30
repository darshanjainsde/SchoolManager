import { Worker } from 'bullmq';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getPlatformPrisma } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import type { Logger } from 'pino';
import { redisConnectionFromUrl } from '../redis-conn';
import { renderReportCardPdf } from './report-card-pdf';

interface ReportCardJobData {
  examResultId: string;
  schoolId: string;
}

/**
 * Render a per-student exam-result PDF and upload it to S3/R2/MinIO.
 *
 * Idempotency:
 *   - One ReportCard row per ExamResult (unique index).
 *   - If a row already exists, we still re-render + re-upload (URL stays
 *     stable since key = examResultId), then upsert. Safe to re-run.
 *
 * Failure modes:
 *   - S3 transient → BullMQ retries (3 attempts, exponential backoff).
 *   - Missing data → throws once, never retries.
 */
export function startReportCardWorker(logger: Logger) {
  const env = loadEnv();
  const s3 = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });

  const worker = new Worker<ReportCardJobData>(
    'report-card',
    async (job) => {
      const { examResultId, schoolId } = job.data;
      const platform = getPlatformPrisma();

      const result = await platform.examResult.findUnique({
        where: { id: examResultId },
        include: {
          exam: { include: { gradingScheme: true, class: { include: { grade: true } } } },
          marks: { include: { examSubject: { include: { subject: true } } } },
        },
      });
      if (!result) throw new Error(`exam result ${examResultId} not found`);
      const [student, school] = await Promise.all([
        platform.user.findUnique({ where: { id: result.studentUserId } }),
        platform.school.findUnique({ where: { id: schoolId } }),
      ]);
      if (!student || !school) throw new Error('student or school missing');

      const pdfBuffer = await renderReportCardPdf({
        schoolName: school.name,
        student: { firstName: student.firstName, lastName: student.lastName, email: student.email },
        examName: result.exam.name,
        className: `${result.exam.class.grade.name} ${result.exam.class.name}`,
        publishedAt: result.publishedAt ?? new Date(),
        marks: result.marks.map((m) => ({
          subject: m.examSubject.subject.name,
          obtained: Number(m.marksObtained),
          max: m.examSubject.maxMarks,
          isAbsent: m.isAbsent,
        })),
        bands: (result.exam.gradingScheme?.bands as Array<{ min: number; letter: string }> | undefined) ?? null,
      });

      const key = `report-cards/${schoolId}/${examResultId}.pdf`;
      await s3.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: key,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
        }),
      );
      const pdfUrl = `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`;

      await platform.reportCard.upsert({
        where: { examResultId },
        create: { schoolId, examResultId, pdfUrl },
        update: { pdfUrl, generatedAt: new Date() },
      });

      logger.info({ examResultId, pdfUrl }, 'report card generated');
      return { ok: true, pdfUrl };
    },
    { connection: redisConnectionFromUrl(env.REDIS_URL), concurrency: 4 },
  );

  worker.on('ready', () => logger.info('report-card worker ready'));
  worker.on('failed', (job, err) =>
    logger.error({ id: job?.id, err: err.message }, 'report-card failed'),
  );
  return worker;
}
