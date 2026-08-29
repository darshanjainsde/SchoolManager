import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { isP2002 } from '../../common/errors/prisma-errors';
import { dateRangeInclusive, isoWeekdayOf, toDateStr } from './internal/leave-dates';
import type {
  CreateLeaveTypeDefDto,
  SetLeaveAllocationDto,
  UpdateLeaveTypeDefDto,
} from './management.dto';
import { LIST_CEILING } from '../../common/lists/list-ceiling';

/**
 * The five types every school starts from — mirrors the `LeaveType` enum so
 * pre-policy applications (which carry only the enum) map 1:1 onto a def.
 */
const BUILTIN_SEED = [
  { builtin: 'SICK', name: 'Sick leave', isPaid: true },
  { builtin: 'CASUAL', name: 'Casual leave', isPaid: true },
  { builtin: 'EARNED', name: 'Earned leave', isPaid: true },
  { builtin: 'UNPAID', name: 'Unpaid leave', isPaid: false },
  { builtin: 'OTHER', name: 'Other', isPaid: true },
] as const;

type UsedKey = `${string}:${string}`; // teacherId:typeDefId

/**
 * Leave policy: the school's own leave vocabulary (`LeaveTypeDef`), yearly
 * per-teacher grants (`LeaveAllocation`), and the balances derived from them.
 *
 * The one invariant everything here leans on: **`used` is never stored**.
 * It is recomputed from APPROVED applications every read, so a cancelled
 * leave refunds itself and the figures cannot drift from the record.
 *
 * A "day" of leave is a WORKING day: inside `School.workingDays` and not on
 * a school holiday — the same days an approval marks `ON_LEAVE` in staff
 * attendance, so the balance always agrees with the attendance record.
 * None of these tables carry RLS; every query's `schoolId` is load-bearing.
 */
@Injectable()
export class LeavePolicyService {
  // ── Types ────────────────────────────────────────────────────────────────

  /** All defs, seeding the five built-ins the first time a school looks. */
  async types(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.leaveTypeDef.findMany({ take: LIST_CEILING.STRUCTURE,
        where: { schoolId },
        orderBy: { createdAt: 'asc' },
      });
      if (existing.length > 0) return existing;

      await tx.leaveTypeDef.createMany({
        data: BUILTIN_SEED.map((s) => ({ schoolId, ...s })),
        // A concurrent first look seeds too — the (schoolId, builtin) unique
        // makes the duplicate a no-op instead of an error.
        skipDuplicates: true,
      });
      return tx.leaveTypeDef.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId }, orderBy: { createdAt: 'asc' } });
    });
  }

  async createType(schoolId: string, dto: CreateLeaveTypeDefDto) {
    return withTenant(schoolId, async (tx) => {
      try {
        return await tx.leaveTypeDef.create({
          data: {
            schoolId,
            name: dto.name.trim(),
            isPaid: dto.isPaid ?? true,
            defaultAnnual: dto.defaultAnnual ?? 0,
            carryForwardCap: dto.carryForwardCap ?? 0,
          },
        });
      } catch (e) {
        if (isP2002(e)) {
          throw new ApiError('LEAVE_TYPE_EXISTS', 'A leave type with that name already exists', 409, 'name');
        }
        throw e;
      }
    });
  }

  async updateType(schoolId: string, id: string, dto: UpdateLeaveTypeDefDto) {
    return withTenant(schoolId, async (tx) => {
      const def = await tx.leaveTypeDef.findFirst({ where: { id, schoolId } });
      if (!def) throw new NotFoundException('Leave type not found');
      try {
        return await tx.leaveTypeDef.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.isPaid !== undefined ? { isPaid: dto.isPaid } : {}),
            ...(dto.defaultAnnual !== undefined ? { defaultAnnual: dto.defaultAnnual } : {}),
            ...(dto.carryForwardCap !== undefined ? { carryForwardCap: dto.carryForwardCap } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          },
        });
      } catch (e) {
        if (isP2002(e)) {
          throw new ApiError('LEAVE_TYPE_EXISTS', 'A leave type with that name already exists', 409, 'name');
        }
        throw e;
      }
    });
  }

  // ── The allotment grid ───────────────────────────────────────────────────

  /**
   * Teachers × active types for one academic year — each cell
   * `{ allotted, carriedIn, used, remaining }`. `year` defaults to the
   * school's current one.
   */
  async grid(schoolId: string, academicYearId?: string) {
    return withTenant(schoolId, async (tx) => {
      const year = await this.resolveYear(tx, schoolId, academicYearId);
      const [defs, teachers, allocations] = await Promise.all([
        tx.leaveTypeDef.findMany({ take: LIST_CEILING.STRUCTURE,
          where: { schoolId, isActive: true },
          orderBy: { createdAt: 'asc' },
        }),
        tx.teacher.findMany({ take: LIST_CEILING.STRUCTURE,
          where: { schoolId, isActive: true },
          select: { id: true, firstName: true, lastName: true },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        }),
        tx.leaveAllocation.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, academicYearId: year.id } }),
      ]);

      const used = await this.usedDays(tx, schoolId, defs, year.startDate, year.endDate);
      const allocByKey = new Map(allocations.map((a) => [`${a.teacherId}:${a.typeDefId}` as UsedKey, a]));

      return {
        academicYear: { id: year.id, name: year.name },
        types: defs.map((d) => ({
          id: d.id,
          name: d.name,
          isPaid: d.isPaid,
          defaultAnnual: d.defaultAnnual,
          carryForwardCap: d.carryForwardCap,
        })),
        teachers: teachers.map((t) => ({
          id: t.id,
          name: `${t.firstName} ${t.lastName}`,
          cells: defs.map((d) => {
            const alloc = allocByKey.get(`${t.id}:${d.id}`);
            const usedDays = used.get(`${t.id}:${d.id}`) ?? 0;
            // No allocation row = the type is untracked for this teacher —
            // used still shows (it happened), remaining is null, not 0-used.
            return {
              typeDefId: d.id,
              allotted: alloc?.allotted ?? null,
              carriedIn: alloc?.carriedIn ?? 0,
              used: usedDays,
              remaining: alloc ? alloc.allotted + alloc.carriedIn - usedDays : null,
            };
          }),
        })),
      };
    });
  }

  /**
   * Grants every active teacher the default quota of every active type that
   * has one — creating rows only where none exist, so a hand-edited cell is
   * never clobbered.
   */
  async applyDefaults(schoolId: string, academicYearId?: string) {
    return withTenant(schoolId, async (tx) => {
      const year = await this.resolveYear(tx, schoolId, academicYearId);
      const [defs, teachers, existing] = await Promise.all([
        tx.leaveTypeDef.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, isActive: true, defaultAnnual: { gt: 0 } } }),
        tx.teacher.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, isActive: true }, select: { id: true } }),
        tx.leaveAllocation.findMany({ take: LIST_CEILING.STRUCTURE,
          where: { schoolId, academicYearId: year.id },
          select: { teacherId: true, typeDefId: true },
        }),
      ]);
      const has = new Set(existing.map((a) => `${a.teacherId}:${a.typeDefId}`));
      const rows = teachers.flatMap((t) =>
        defs
          .filter((d) => !has.has(`${t.id}:${d.id}`))
          .map((d) => ({
            schoolId,
            teacherId: t.id,
            typeDefId: d.id,
            academicYearId: year.id,
            allotted: d.defaultAnnual,
          })),
      );
      if (rows.length > 0) await tx.leaveAllocation.createMany({ data: rows });
      return { created: rows.length };
    });
  }

  /** Upserts one grid cell. */
  async setAllocation(schoolId: string, dto: SetLeaveAllocationDto) {
    return withTenant(schoolId, async (tx) => {
      const [def, teacher, year] = await Promise.all([
        tx.leaveTypeDef.findFirst({ where: { id: dto.typeDefId, schoolId } }),
        tx.teacher.findFirst({ where: { id: dto.teacherId, schoolId }, select: { id: true } }),
        tx.academicYear.findFirst({ where: { id: dto.academicYearId, schoolId } }),
      ]);
      if (!def) throw new ApiError('VALIDATION', 'typeDefId not found in this school', 400, 'typeDefId');
      if (!teacher) throw new ApiError('VALIDATION', 'teacherId not found in this school', 400, 'teacherId');
      if (!year) throw new ApiError('VALIDATION', 'academicYearId not found in this school', 400, 'academicYearId');

      return tx.leaveAllocation.upsert({
        where: {
          schoolId_teacherId_typeDefId_academicYearId: {
            schoolId,
            teacherId: dto.teacherId,
            typeDefId: dto.typeDefId,
            academicYearId: dto.academicYearId,
          },
        },
        create: {
          schoolId,
          teacherId: dto.teacherId,
          typeDefId: dto.typeDefId,
          academicYearId: dto.academicYearId,
          allotted: dto.allotted,
          carriedIn: dto.carriedIn ?? 0,
        },
        update: {
          allotted: dto.allotted,
          ...(dto.carriedIn !== undefined ? { carriedIn: dto.carriedIn } : {}),
        },
      });
    });
  }

  // ── Year close / carry-forward ───────────────────────────────────────────

  /**
   * Carries unused balances from one year into the next:
   * `carriedIn(to) = min(remaining(from), type.carryForwardCap)` per teacher
   * × type with a cap. Idempotent — re-running recomputes and overwrites the
   * carried figure (safe until people start using days in the new year, so
   * the UI words it as a year-end action). Days above the cap lapse.
   */
  async closeYear(schoolId: string, fromAcademicYearId: string, toAcademicYearId: string) {
    if (fromAcademicYearId === toAcademicYearId) {
      throw new ApiError('VALIDATION', 'from and to must be different academic years', 400);
    }
    return withTenant(schoolId, async (tx) => {
      const [from, to] = await Promise.all([
        tx.academicYear.findFirst({ where: { id: fromAcademicYearId, schoolId } }),
        tx.academicYear.findFirst({ where: { id: toAcademicYearId, schoolId } }),
      ]);
      if (!from || !to) throw new NotFoundException('Academic year not found');

      const defs = await tx.leaveTypeDef.findMany({ take: LIST_CEILING.STRUCTURE,
        where: { schoolId, isActive: true, carryForwardCap: { gt: 0 } },
      });
      if (defs.length === 0) return { carried: 0 };

      const allocations = await tx.leaveAllocation.findMany({ take: LIST_CEILING.STRUCTURE,
        where: { schoolId, academicYearId: from.id, typeDefId: { in: defs.map((d) => d.id) } },
      });
      const used = await this.usedDays(tx, schoolId, defs, from.startDate, from.endDate);
      const capByDef = new Map(defs.map((d) => [d.id, d.carryForwardCap]));
      const defaultByDef = new Map(defs.map((d) => [d.id, d.defaultAnnual]));

      let carried = 0;
      for (const alloc of allocations) {
        const remaining =
          alloc.allotted + alloc.carriedIn - (used.get(`${alloc.teacherId}:${alloc.typeDefId}`) ?? 0);
        const carryIn = Math.min(Math.max(remaining, 0), capByDef.get(alloc.typeDefId) ?? 0);
        if (carryIn <= 0) continue;

        await tx.leaveAllocation.upsert({
          where: {
            schoolId_teacherId_typeDefId_academicYearId: {
              schoolId,
              teacherId: alloc.teacherId,
              typeDefId: alloc.typeDefId,
              academicYearId: to.id,
            },
          },
          create: {
            schoolId,
            teacherId: alloc.teacherId,
            typeDefId: alloc.typeDefId,
            academicYearId: to.id,
            allotted: defaultByDef.get(alloc.typeDefId) ?? 0,
            carriedIn: carryIn,
          },
          update: { carriedIn: carryIn },
        });
        carried += 1;
      }
      return { carried };
    });
  }

  // ── Balances ─────────────────────────────────────────────────────────────

  /** The calling teacher's own balances for the current year. */
  async balanceForUser(schoolId: string, userId: string) {
    return withTenant(schoolId, async (tx) => {
      const teacher = await tx.teacher.findFirst({ where: { schoolId, userId }, select: { id: true } });
      if (!teacher) throw new NotFoundException('No teacher record for this login');
      const year = await this.resolveYear(tx, schoolId, undefined);
      const defs = await tx.leaveTypeDef.findMany({ take: LIST_CEILING.STRUCTURE,
        where: { schoolId, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      const allocations = await tx.leaveAllocation.findMany({ take: LIST_CEILING.STRUCTURE,
        where: { schoolId, academicYearId: year.id, teacherId: teacher.id },
      });
      const used = await this.usedDays(tx, schoolId, defs, year.startDate, year.endDate, teacher.id);
      const allocByDef = new Map(allocations.map((a) => [a.typeDefId, a]));

      return {
        academicYear: { id: year.id, name: year.name },
        balances: defs
          .map((d) => {
            const alloc = allocByDef.get(d.id);
            const usedDays = used.get(`${teacher.id}:${d.id}`) ?? 0;
            return {
              typeDefId: d.id,
              name: d.name,
              builtin: d.builtin,
              isPaid: d.isPaid,
              allotted: alloc?.allotted ?? null,
              carriedIn: alloc?.carriedIn ?? 0,
              used: usedDays,
              remaining: alloc ? alloc.allotted + alloc.carriedIn - usedDays : null,
            };
          })
          // A type the teacher has no grant for and never used is noise.
          .filter((b) => b.allotted !== null || b.used > 0),
      };
    });
  }

  /**
   * Approval context for every PENDING application: the working days it asks
   * for and what that teacher has left of that type this year — so the admin
   * screen can warn "this approval overshoots by N days" BEFORE approving.
   * Warn, never block: the admin may knowingly approve into the negative.
   * Keyed by application id; `remaining: null` = the type is untracked.
   */
  async pendingApprovalContext(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const year = await tx.academicYear.findFirst({ where: { schoolId, isCurrent: true } });
      if (!year) return {};

      const pending = await tx.leaveApplication.findMany({ take: LIST_CEILING.ACTIVITY,
        where: { schoolId, status: 'PENDING' },
        select: { id: true, teacherId: true, type: true, typeDefId: true, startDate: true, endDate: true },
      });
      if (pending.length === 0) return {};

      const defs = await tx.leaveTypeDef.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, isActive: true } });
      const defByBuiltin = new Map(defs.filter((d) => d.builtin).map((d) => [d.builtin as string, d.id]));
      const defNameById = new Map(defs.map((d) => [d.id, d.name]));
      const allocations = await tx.leaveAllocation.findMany({ take: LIST_CEILING.STRUCTURE,
        where: { schoolId, academicYearId: year.id },
      });
      const allocByKey = new Map(allocations.map((a) => [`${a.teacherId}:${a.typeDefId}`, a]));
      const used = await this.usedDays(tx, schoolId, defs, year.startDate, year.endDate);

      const out: Record<string, { requestedDays: number; remaining: number | null; typeName: string | null }> = {};
      for (const app of pending) {
        const defId = app.typeDefId ?? defByBuiltin.get(app.type);
        const requestedDays = await this.workingDayCount(tx, schoolId, app.startDate, app.endDate);
        if (!defId) {
          out[app.id] = { requestedDays, remaining: null, typeName: null };
          continue;
        }
        const alloc = allocByKey.get(`${app.teacherId}:${defId}`);
        const remaining = alloc
          ? alloc.allotted + alloc.carriedIn - (used.get(`${app.teacherId}:${defId}`) ?? 0)
          : null;
        out[app.id] = { requestedDays, remaining, typeName: defNameById.get(defId) ?? null };
      }
      return out;
    });
  }

  /**
   * Working days of leave `[startDate, endDate]` costs, for the apply form's
   * "this will use N days" hint and the approval overshoot warning.
   */
  async workingDayCount(tx: TenantTx, schoolId: string, startDate: Date, endDate: Date): Promise<number> {
    const school = await tx.school.findUnique({ where: { id: schoolId }, select: { workingDays: true } });
    const holidays = await this.holidaySet(tx, schoolId, startDate, endDate);
    const working = new Set(school?.workingDays ?? [1, 2, 3, 4, 5, 6]);
    return dateRangeInclusive(toDateStr(startDate), toDateStr(endDate)).filter(
      (d) => working.has(isoWeekdayOf(d)) && !holidays.has(d),
    ).length;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async resolveYear(tx: TenantTx, schoolId: string, academicYearId: string | undefined) {
    const year = academicYearId
      ? await tx.academicYear.findFirst({ where: { id: academicYearId, schoolId } })
      : await tx.academicYear.findFirst({ where: { schoolId, isCurrent: true } });
    if (!year) {
      throw new ApiError('NO_ACADEMIC_YEAR', 'Set up an academic year before configuring leave', 404);
    }
    return year;
  }

  /**
   * Working days of APPROVED leave per (teacher, typeDef) inside the year
   * window. Pre-policy applications carry no `typeDefId`; they resolve
   * through their built-in enum so history still counts.
   */
  private async usedDays(
    tx: TenantTx,
    schoolId: string,
    defs: { id: string; builtin: string | null }[],
    yearStart: Date,
    yearEnd: Date,
    teacherId?: string,
  ): Promise<Map<UsedKey, number>> {
    const apps = await tx.leaveApplication.findMany({ take: LIST_CEILING.ACTIVITY,
      where: {
        schoolId,
        status: 'APPROVED',
        ...(teacherId ? { teacherId } : {}),
        startDate: { lte: yearEnd },
        endDate: { gte: yearStart },
      },
      select: { teacherId: true, type: true, typeDefId: true, startDate: true, endDate: true },
    });
    if (apps.length === 0) return new Map();

    const school = await tx.school.findUnique({ where: { id: schoolId }, select: { workingDays: true } });
    const working = new Set(school?.workingDays ?? [1, 2, 3, 4, 5, 6]);
    const holidays = await this.holidaySet(tx, schoolId, yearStart, yearEnd);
    const defByBuiltin = new Map(defs.filter((d) => d.builtin).map((d) => [d.builtin as string, d.id]));

    const out = new Map<UsedKey, number>();
    const startStr = toDateStr(yearStart);
    const endStr = toDateStr(yearEnd);
    for (const app of apps) {
      const defId = app.typeDefId ?? defByBuiltin.get(app.type);
      if (!defId) continue; // a custom def was deleted — nothing to count against
      // Clamp to the year window so a leave spanning the boundary splits
      // between the two years instead of double-counting.
      const from = toDateStr(app.startDate) < startStr ? startStr : toDateStr(app.startDate);
      const to = toDateStr(app.endDate) > endStr ? endStr : toDateStr(app.endDate);
      const days = dateRangeInclusive(from, to).filter(
        (d) => working.has(isoWeekdayOf(d)) && !holidays.has(d),
      ).length;
      if (days === 0) continue;
      const key: UsedKey = `${app.teacherId}:${defId}`;
      out.set(key, (out.get(key) ?? 0) + days);
    }
    return out;
  }

  /** Every holiday date string inside `[from, to]`, ranges expanded. */
  private async holidaySet(tx: TenantTx, schoolId: string, from: Date, to: Date): Promise<Set<string>> {
    const rows = await tx.holiday.findMany({ take: LIST_CEILING.STRUCTURE,
      where: { schoolId, startDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] },
      select: { startDate: true, endDate: true },
    });
    const out = new Set<string>();
    for (const h of rows) {
      for (const d of dateRangeInclusive(toDateStr(h.startDate), toDateStr(h.endDate ?? h.startDate))) {
        out.add(d);
      }
    }
    return out;
  }
}
