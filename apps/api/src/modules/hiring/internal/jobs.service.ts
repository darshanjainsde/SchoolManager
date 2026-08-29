import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { getPlatformPrisma, Prisma, withTenant } from '@skoolos/db';
import { TenantContextService } from '../../tenancy';
import type { ApplyDto, CreateJobDto, ModerateJobDto, UpdateJobDto } from './hiring.dto';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';

/** Four questions maximum. The cost lands on the candidate; the benefit on the admin. */
export const MAX_QUESTIONS = 4;

/**
 * Vacancies, their screening questions, and the applications against them.
 *
 * Hiring appears ONLY on sckools.com. That host resolves to the platform, not
 * to a school, so the public half of this service has NO tenant context and
 * runs on the platform connection with RLS bypassed. Everything the school
 * itself reads runs under `withTenant`, which is where the single-tenant rule
 * on applications actually bites.
 *
 * See docs/superpowers/specs/2026-08-05-hiring-design.md.
 */
@Injectable()
export class JobsService {
  constructor(private readonly tenant: TenantContextService) {}

  // ── The school's own vacancies ───────────────────────────────────────────

  async list() {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, (tx) =>
      tx.jobPost.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId }, orderBy: { createdAt: 'desc' }, include: { questions: true } }),
    );
  }

  async create(dto: CreateJobDto) {
    const { schoolId } = this.tenant.requireTenant();
    this.assertQuestionCount(dto.questions?.length ?? 0);
    return withTenant(schoolId, async (tx) => {
      const post = await tx.jobPost.create({
        data: {
          schoolId,
          title: dto.title,
          summary: dto.summary,
          description: dto.description,
          employmentType: dto.employmentType ?? 'FULL_TIME',
          subject: dto.subject ?? null,
          posts: dto.posts ?? 1,
          salaryMinMinor: dto.salaryMinMinor ?? null,
          salaryMaxMinor: dto.salaryMaxMinor ?? null,
          currency: dto.currency ?? 'INR',
          applyBy: dto.applyBy ? new Date(dto.applyBy) : null,
          // Nothing goes public by being typed.
          status: 'DRAFT',
        },
      });
      await this.writeQuestions(tx, post.id, schoolId, dto.questions ?? []);
      return post;
    });
  }

  async update(id: string, dto: UpdateJobDto) {
    const { schoolId } = this.tenant.requireTenant();
    this.assertQuestionCount(dto.questions?.length ?? 0);
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.jobPost.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Vacancy not found');

      // Editing an APPROVED vacancy re-enters moderation, for the same reason
      // editing an approved NETWORK event does: otherwise an admin can push
      // arbitrary content live on the owner's own site with no second look.
      const status = existing.status === 'APPROVED' ? ('PENDING' as const) : undefined;

      const post = await tx.jobPost.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.summary !== undefined ? { summary: dto.summary } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.employmentType !== undefined ? { employmentType: dto.employmentType } : {}),
          ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
          ...(dto.posts !== undefined ? { posts: dto.posts } : {}),
          ...(dto.salaryMinMinor !== undefined ? { salaryMinMinor: dto.salaryMinMinor } : {}),
          ...(dto.salaryMaxMinor !== undefined ? { salaryMaxMinor: dto.salaryMaxMinor } : {}),
          ...(dto.applyBy !== undefined ? { applyBy: dto.applyBy ? new Date(dto.applyBy) : null } : {}),
          ...(status ? { status } : {}),
        },
      });
      if (dto.questions) {
        await tx.jobQuestion.deleteMany({ where: { schoolId, jobPostId: id } });
        await this.writeQuestions(tx, id, schoolId, dto.questions);
      }
      return post;
    });
  }

  async submit(id: string) {
    return this.setStatus(id, 'PENDING');
  }

  async close(id: string) {
    return this.setStatus(id, 'CLOSED');
  }

  /** The school's own applications. Tenant-scoped, which is the whole protection. */
  async applications(jobPostId: string) {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const post = await tx.jobPost.findFirst({ where: { id: jobPostId, schoolId }, include: { questions: true } });
      if (!post) throw new NotFoundException('Vacancy not found');
      const applications = await tx.jobApplication.findMany({ take: LIST_CEILING.ACTIVITY,
        where: { jobPostId, schoolId },
        orderBy: { createdAt: 'desc' },
      });
      return { post, applications };
    });
  }

  async setApplicationStatus(id: string, dto: { status?: string; note?: string }) {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.jobApplication.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Application not found');
      return tx.jobApplication.update({
        where: { id },
        data: {
          ...(dto.status ? { status: dto.status as 'NEW' } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
        },
      });
    });
  }

  // ── The owner's queue ────────────────────────────────────────────────────

  /** Runs on the platform connection: the owner has no tenant. */
  async ownerList(status?: string) {
    return getPlatformPrisma().jobPost.findMany({
      where: status ? { status: status as 'PENDING' } : {},
      orderBy: { createdAt: 'desc' },
      include: { school: { select: { name: true, slug: true } }, questions: true },
    });
  }

  async moderate(id: string, dto: ModerateJobDto) {
    if (dto.decision === 'REJECT' && !dto.reason?.trim()) {
      // A refusal with no reason is one the school cannot act on.
      throw new BadRequestException('Tell the school why it was rejected');
    }
    const platform = getPlatformPrisma();
    const post = await platform.jobPost.findFirst({ where: { id } });
    if (!post) throw new NotFoundException('Vacancy not found');
    return platform.jobPost.update({
      where: { id },
      data:
        dto.decision === 'APPROVE'
          ? { status: 'APPROVED', approvedAt: new Date(), rejectedReason: null }
          : { status: 'REJECTED', rejectedReason: dto.reason },
    });
  }

  // ── The public board on sckools.com ──────────────────────────────────────

  async publicBoard(filters: { school?: string; employmentType?: string; subject?: string }) {
    return getPlatformPrisma().jobPost.findMany({
      where: {
        status: 'APPROVED',
        ...(filters.employmentType ? { employmentType: filters.employmentType as 'FULL_TIME' } : {}),
        ...(filters.subject ? { subject: { contains: filters.subject, mode: 'insensitive' as const } } : {}),
        ...(filters.school ? { school: { slug: filters.school } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      // Scalars plus the school's public identity. Deliberately no relation to
      // applications: the board must not be able to leak a candidate.
      select: {
        id: true,
        title: true,
        summary: true,
        employmentType: true,
        subject: true,
        posts: true,
        salaryMinMinor: true,
        salaryMaxMinor: true,
        currency: true,
        applyBy: true,
        createdAt: true,
        school: { select: { name: true, slug: true } },
      },
    });
  }

  async publicOne(id: string) {
    const post = await getPlatformPrisma().jobPost.findFirst({
      where: { id, status: 'APPROVED' },
      select: {
        id: true,
        title: true,
        summary: true,
        description: true,
        employmentType: true,
        subject: true,
        posts: true,
        salaryMinMinor: true,
        salaryMaxMinor: true,
        currency: true,
        applyBy: true,
        school: { select: { name: true, slug: true } },
        questions: { orderBy: { order: 'asc' }, select: { id: true, prompt: true, kind: true, options: true, required: true } },
      },
    });
    if (!post) throw new NotFoundException('Vacancy not found');
    return post;
  }

  /**
   * A stranger applying. THE GUARD IS THIS METHOD, not RLS.
   *
   * sckools.com has no tenant context, so this runs on the platform
   * connection. `schoolId` and `jobPostId` are therefore taken from the vacancy
   * row — never from the request — so a caller cannot file a candidate into a
   * school it names.
   */
  async apply(jobPostId: string, dto: ApplyDto) {
    const platform = getPlatformPrisma();
    const post = await platform.jobPost.findFirst({ where: { id: jobPostId } });
    if (!post) throw new NotFoundException('Vacancy not found');
    if (post.status !== 'APPROVED') {
      throw new BadRequestException('That vacancy is not open for applications');
    }

    // Only answers to questions this vacancy actually asked. Without this the
    // answers blob is an unbounded write from a public endpoint.
    const asked = await platform.jobQuestion.findMany({ where: { jobPostId }, select: { id: true } });
    const allowed = new Set(asked.map((q) => q.id));
    const answers: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto.answers ?? {})) {
      if (allowed.has(key)) answers[key] = value;
    }

    return platform.jobApplication.create({
      data: {
        jobPostId: post.id,
        schoolId: post.schoolId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone ?? null,
        cvUrl: dto.cvUrl,
        // Prisma types a Json column as InputJsonValue, not a plain object.
        answers: answers as Prisma.InputJsonValue,
        status: 'NEW',
      },
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private assertQuestionCount(count: number) {
    if (count > MAX_QUESTIONS) {
      throw new BadRequestException(
        `A vacancy may ask at most ${MAX_QUESTIONS} questions — every one of them costs the candidate something.`,
      );
    }
  }

  private async setStatus(id: string, status: 'PENDING' | 'CLOSED') {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.jobPost.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Vacancy not found');
      return tx.jobPost.update({ where: { id }, data: { status } });
    });
  }

  private async writeQuestions(
    tx: { jobQuestion: { createMany(args: unknown): Promise<unknown> } },
    jobPostId: string,
    schoolId: string,
    questions: CreateJobDto['questions'],
  ) {
    if (!questions?.length) return;
    await tx.jobQuestion.createMany({
      data: questions.map((q, i) => ({
        jobPostId,
        schoolId,
        prompt: q.prompt,
        kind: q.kind,
        options: q.kind === 'CHOICE' ? (q.options ?? []) : [],
        required: q.required ?? false,
        order: i,
      })),
    });
  }
}
