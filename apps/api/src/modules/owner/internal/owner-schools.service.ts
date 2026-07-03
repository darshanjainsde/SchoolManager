import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { getPlatformPrisma, resolveFeatures, Prisma } from '@skoolos/db';
import { randomBytes } from 'node:crypto';
import { PasswordService } from '../../auth';
import { FeatureResolverService } from '../../features/internal/feature-resolver.service';
import { CreateSchoolDto } from './owner.dto';

export interface StatsResponse {
  schools: { total: number; byTier: { BASIC: number; STANDARD: number; PRO: number }; live: number; suspended: number };
  domains: { live: number };
}

export interface SchoolRow {
  id: string;
  name: string;
  slug: string;
  tier: 'BASIC' | 'STANDARD' | 'PRO';
  status: string;
  primaryDomain: string | null;
  features: string[];
}

export interface SchoolDetail extends SchoolRow {
  domains: { hostname: string; status: string; isPrimary: boolean }[];
}

@Injectable()
export class OwnerSchoolsService {
  constructor(
    private readonly featureResolver: FeatureResolverService,
    private readonly passwords: PasswordService,
  ) {}

  async stats(): Promise<StatsResponse> {
    const db = getPlatformPrisma();
    const [byTier, live, suspended, total, liveDomains] = await Promise.all([
      db.school.groupBy({ by: ['tier'], _count: true }),
      db.school.count({ where: { status: 'LIVE' } }),
      db.school.count({ where: { status: 'SUSPENDED' } }),
      db.school.count(),
      db.domain.count({ where: { status: 'LIVE' } }),
    ]);
    const tierMap = { BASIC: 0, STANDARD: 0, PRO: 0 } as Record<'BASIC' | 'STANDARD' | 'PRO', number>;
    for (const g of byTier) tierMap[g.tier as 'BASIC' | 'STANDARD' | 'PRO'] = g._count;
    return { schools: { total, byTier: tierMap, live, suspended }, domains: { live: liveDomains } };
  }

  async list(): Promise<SchoolRow[]> {
    const db = getPlatformPrisma();
    const schools = await db.school.findMany({
      orderBy: { name: 'asc' },
      include: { domains: { where: { isPrimary: true }, take: 1 }, featureOverrides: true },
    });
    return schools.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      tier: s.tier as 'BASIC' | 'STANDARD' | 'PRO',
      status: s.status,
      primaryDomain: s.domains[0]?.hostname ?? null,
      features: [...resolveFeatures(s.tier as 'BASIC' | 'STANDARD' | 'PRO', s.featureOverrides)],
    }));
  }

  async detail(id: string): Promise<SchoolDetail> {
    const db = getPlatformPrisma();
    const s = await db.school.findUnique({
      where: { id },
      include: { domains: true, featureOverrides: true },
    });
    if (!s) throw new NotFoundException(`School ${id} not found`);
    return {
      id: s.id,
      name: s.name,
      slug: s.slug,
      tier: s.tier as 'BASIC' | 'STANDARD' | 'PRO',
      status: s.status,
      primaryDomain: s.domains.find((d) => d.isPrimary)?.hostname ?? null,
      features: [...resolveFeatures(s.tier as 'BASIC' | 'STANDARD' | 'PRO', s.featureOverrides)],
      domains: s.domains.map((d) => ({ hostname: d.hostname, status: d.status, isPrimary: d.isPrimary })),
    };
  }

  async create(dto: CreateSchoolDto): Promise<{ id: string; slug: string; tempPassword: string }> {
    const db = getPlatformPrisma();
    const clash = await db.school.findFirst({
      where: { OR: [{ slug: dto.slug }, { domains: { some: { hostname: dto.domainHostname } } }] },
    });
    if (clash) throw new ConflictException('Slug or domain already in use');

    const tempPassword = randomBytes(8).toString('base64url');
    const passwordHash = await this.passwords.hash(tempPassword);
    const defaultGrades = ['Nursery', 'Grade 1', 'Grade 2', 'Grade 3'];

    let school;
    try {
      school = await db.$transaction(async (tx) => {
        const s = await tx.school.create({ data: { name: dto.name, slug: dto.slug, tier: dto.tier, status: 'SETUP' } });
        await tx.domain.create({
          data: { schoolId: s.id, hostname: dto.domainHostname, type: 'CUSTOM', status: 'PENDING', isPrimary: true },
        });
        await tx.user.create({
          data: { schoolId: s.id, email: dto.adminEmail.toLowerCase(), passwordHash, role: 'SCHOOL_ADMIN' },
        });
        await tx.schoolProfile.create({ data: { schoolId: s.id } });
        await tx.homepageContent.create({ data: { schoolId: s.id, headline: `Welcome to ${dto.name}` } });
        await tx.grade.createMany({
          data: defaultGrades.map((name, order) => ({ schoolId: s.id, name, order })),
        });
        return s;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Slug or domain already in use');
      }
      throw e;
    }

    return { id: school.id, slug: school.slug, tempPassword };
  }

  async setTier(id: string, tier: 'BASIC' | 'STANDARD' | 'PRO'): Promise<SchoolDetail> {
    const db = getPlatformPrisma();
    try {
      await db.school.update({ where: { id }, data: { tier } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException(`School ${id} not found`);
      }
      throw e;
    }
    await this.featureResolver.invalidate(id);
    return this.detail(id);
  }

  async setFeature(id: string, featureKey: string, enabled: boolean): Promise<SchoolDetail> {
    const db = getPlatformPrisma();
    try {
      await db.featureOverride.upsert({
        where: { schoolId_featureKey: { schoolId: id, featureKey } },
        update: { enabled },
        create: { schoolId: id, featureKey, enabled },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException(`School ${id} not found`);
      }
      throw e;
    }
    await this.featureResolver.invalidate(id);
    return this.detail(id);
  }
}
