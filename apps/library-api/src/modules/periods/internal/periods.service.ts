import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type LibraryTx } from '@library/db';
import { assertBranchInScope } from '../../../common/guards/assert-branch-in-scope';
import { liveVisits, markAttendance, orgToday } from '@library/core';
import type {
  CreatePeriodDto, ListPeriodsQueryDto, ListVisitsQueryDto,
  MarkAttendanceDto, OpenVisitDto, UpdateSettingsDto,
} from './dto';


/** The shape a library behaves as before anyone has saved a setting. */
const DEFAULT_SETTINGS = {
  concurrentClassCapacity: 2,
  recordAttendance: true,
  // Off: most schools charge children nothing, and a default that quietly
  // bills a ten-year-old is the wrong default.
  chargeStudentFines: false,
} as const;

/**
 * Ensure a settings row exists, without a race.
 *
 * This was find-then-create. The unique on `orgId` protects the DATA but not
 * the caller: the losing create raises P2002, which poisons the whole
 * transaction and 500s the request. The console's first paint for a new org
 * fires three of these concurrently, so it was near-guaranteed on the very
 * first load — the worst possible moment.
 *
 * `ON CONFLICT DO NOTHING` cannot raise, so the read after it always finds a row.
 */
async function ensureSettings(tx: LibraryTx, orgId: string) {
  await tx.$executeRaw`
    INSERT INTO "LibrarySettings" ("id", "orgId", "updatedAt")
    VALUES (gen_random_uuid(), ${orgId}::uuid, now())
    ON CONFLICT ("orgId") DO NOTHING
  `;
  const row = await tx.librarySettings.findUnique({ where: { orgId } });
  if (!row) throw new NotFoundException('Org not found');
  return row;
}

/**
 * `orgToday` — "today, in the ORG's timezone, never the server's" — moved to
 * `@library/core` (`periods/visits.ts`) with the two paths below that depend
 * on it. `openVisit` still calls it, from there.
 */

@Injectable()
export class PeriodsService {
  // ------------------------------------------------------------- settings

  /**
   * A GET must not write. The previous version created the row on read, which
   * made a read take row locks, fail against a read-only transaction, and be
   * non-idempotent. If nothing has been saved yet, the library simply behaves
   * as the defaults describe.
   */
  async getSettings(tx: LibraryTx, orgId: string) {
    const row = await tx.librarySettings.findUnique({ where: { orgId } });
    return row ?? { orgId, ...DEFAULT_SETTINGS };
  }

  async updateSettings(tx: LibraryTx, orgId: string, dto: UpdateSettingsDto) {
    await ensureSettings(tx, orgId);
    return tx.librarySettings.update({ where: { orgId }, data: { ...dto } });
  }

  // ------------------------------------------------------------- timetable

  /**
   * Add a class to a slot, refusing to over-fill the room.
   *
   * The capacity check happens HERE and not as a database constraint because a
   * unique index can say "at most one" and never "at most N" — and N is a
   * setting the librarian changes.
   *
   * It is a WARNING, not a gate, which is what makes the read-then-count safe
   * enough. An earlier comment here claimed two clerks would "serialise on the
   * insert": that was false. The only index on the slot is
   * (branchId, weekday, period, classRef), so two clerks adding DIFFERENT
   * classes to the same slot produce different keys and nothing serialises —
   * both counts read 1 against a capacity of 2 and both succeed. The worst
   * outcome now is a warning that fails to fire on a simultaneous double
   * booking, not a room silently over-filled behind a guarantee that was
   * never there.
   *
   * Refusing at the point of ASSIGNING is the whole value: discovering the room
   * is over-booked when eighty children arrive is not a validation, it is an
   * incident.
   */
  async createPeriod(tx: LibraryTx, orgId: string, dto: CreatePeriodDto, allowedBranches: string[]) {
    const branch = await tx.branch.findFirst({ where: { id: dto.branchId, orgId }, select: { id: true } });
    if (!branch) throw new NotFoundException('Branch not found');
    assertBranchInScope(dto.branchId, allowedBranches);

    const { concurrentClassCapacity } = await ensureSettings(tx, orgId);
    const alreadyInSlot = await tx.libraryPeriod.count({
      where: { orgId, branchId: dto.branchId, weekday: dto.weekday, period: dto.period },
    });
    // Over capacity is a WARNING, not a refusal.
    //
    // The librarian does not author the school timetable, she receives it. If
    // the school has put three classes in period 3, refusing to record that
    // does not empty the room — it just means the software cannot describe
    // Tuesday. So the row is written and the caller is told, loudly, that the
    // room is over-subscribed; the console surfaces it and the librarian takes
    // it to whoever builds the timetable.
    const overCapacity = alreadyInSlot >= concurrentClassCapacity;

    try {
      const period = await tx.libraryPeriod.create({ data: { orgId, ...dto } });
      return {
        ...period,
        overCapacity,
        warning: overCapacity
          ? `The library is set to hold ${concurrentClassCapacity} class(es) at once; this period now has ${alreadyInSlot + 1}`
          : null,
      };
    } catch (err) {
      // ONLY the (branch, weekday, period, classRef) unique violation means
      // "already scheduled". A bare catch here reported a dropped connection, a
      // transaction timeout and a bad branch id all as
      // "That class already has the library in that period" — three different
      // faults wearing the same friendly message, and nobody would look further.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          reason: 'ALREADY_SCHEDULED',
          message: 'That class already has the library in that period',
        });
      }
      throw err;
    }
  }

  listPeriods(tx: LibraryTx, orgId: string, query: ListPeriodsQueryDto, allowedBranches: string[]) {
    return tx.libraryPeriod.findMany({
      where: {
        orgId,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.weekday ? { weekday: query.weekday } : {}),
        ...(allowedBranches.length > 0 ? { branchId: { in: allowedBranches } } : {}),
      },
      orderBy: [{ weekday: 'asc' }, { period: 'asc' }, { classRef: 'asc' }],
    });
  }

  async removePeriod(tx: LibraryTx, orgId: string, id: string, allowedBranches: string[]) {
    const row = await tx.libraryPeriod.findFirst({ where: { id, orgId }, select: { id: true, branchId: true } });
    if (!row) throw new NotFoundException('Period not found');
    assertBranchInScope(row.branchId, allowedBranches);
    await tx.libraryPeriod.delete({ where: { id } });
    return { ok: true };
  }

  // ---------------------------------------------------------------- visits

  /**
   * Open a class's visit for today, or return the one already open.
   *
   * Idempotent by (org, class, date): a class that comes back after break is
   * the same visit reopened, not a second record for the same day that someone
   * later has to reconcile.
   */
  async openVisit(tx: LibraryTx, orgId: string, dto: OpenVisitDto, allowedBranches: string[]) {
    assertBranchInScope(dto.branchId, allowedBranches);
    const date = await orgToday(tx, orgId);

    const existing = await tx.classVisit.findFirst({ where: { orgId, branchId: dto.branchId, classRef: dto.classRef, date } });
    if (existing) {
      return existing.closedAt
        ? tx.classVisit.update({ where: { id: existing.id }, data: { closedAt: null } })
        : existing;
    }
    return tx.classVisit.create({
      data: { orgId, branchId: dto.branchId, classRef: dto.classRef, periodId: dto.periodId ?? null, date },
    });
  }

  async closeVisit(tx: LibraryTx, orgId: string, id: string, allowedBranches: string[]) {
    const visit = await tx.classVisit.findFirst({ where: { id, orgId } });
    if (!visit) throw new NotFoundException('Visit not found');
    assertBranchInScope(visit.branchId, allowedBranches);
    return tx.classVisit.update({ where: { id }, data: { closedAt: new Date() } });
  }

  /**
   * Who is in the library right now, with the roster for each class.
   *
   * The implementation moved to `@library/core` (`periods/visits.ts`) so the
   * librarian's counter inside Sckools can paint the same screen — `apps/api`
   * cannot import this app. Why one query per concern rather than one per
   * child, and why `seen` carries three states rather than a boolean, is
   * documented there, at the code it explains.
   */
  liveVisits(tx: LibraryTx, orgId: string, allowedBranches: string[]) {
    return liveVisits(tx, orgId, allowedBranches);
  }

  /**
   * Tick or untick by hand. The auto rows are written by circulation, not here.
   *
   * Moved to `@library/core` alongside `liveVisits` — the read that paints the
   * roster and the write that ticks it are one feature, and splitting them
   * across the two packages would let the counter tick against a roster the
   * library console computes differently.
   */
  markAttendance(tx: LibraryTx, orgId: string, visitId: string, dto: MarkAttendanceDto, allowedBranches: string[]) {
    return markAttendance(tx, orgId, visitId, dto, allowedBranches);
  }

  listVisits(tx: LibraryTx, orgId: string, query: ListVisitsQueryDto, allowedBranches: string[]) {
    return tx.classVisit.findMany({
      where: {
        orgId,
        ...(query.date ? { date: new Date(`${query.date}T00:00:00.000Z`) } : {}),
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(allowedBranches.length > 0 ? { branchId: { in: allowedBranches } } : {}),
      },
      include: { _count: { select: { attendance: true } } },
      orderBy: [{ date: 'desc' }, { openedAt: 'desc' }],
      take: 100,
    });
  }
}

