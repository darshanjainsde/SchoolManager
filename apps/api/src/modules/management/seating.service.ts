import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import {
  DEFAULT_SEATING_RULES,
  type SavedSeatingPlan,
  type SeatingPlanResult,
  type SeatingPlanSummary,
  type SeatingRules,
} from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { isP2025 } from '../../common/errors/prisma-errors';
import { generateSeating, type SeatingClass } from './seating-engine';
import type { PreviewSeatingDto, SaveSeatingDto } from './management.dto';

@Injectable()
export class SeatingService {
  /**
   * A rules object off the wire is not trusted to be complete — an older
   * client, or a saved plan written before a rule existed, would otherwise
   * leave a field `undefined` and the engine would read that as "off".
   */
  private static rules(input?: Partial<SeatingRules>): SeatingRules {
    return {
      noClassmates: input?.noClassmates ?? DEFAULT_SEATING_RULES.noClassmates,
      alternateCols: input?.alternateCols ?? DEFAULT_SEATING_RULES.alternateCols,
      spreadRolls: input?.spreadRolls ?? DEFAULT_SEATING_RULES.spreadRolls,
      backRowFree: input?.backRowFree ?? DEFAULT_SEATING_RULES.backRowFree,
    };
  }

  /**
   * Loads the ticked sections with their active students.
   *
   * The section ids arrive from the client, so this is also the tenancy check:
   * the query is scoped by `schoolId` inside `withTenant`, and any id that does
   * not come back is rejected by name rather than silently seating an empty
   * room. Order follows the ids the office ticked, so the same tick order
   * always produces the same chart.
   */
  private async loadClasses(schoolId: string, sectionIds: string[]): Promise<SeatingClass[]> {
    const unique = [...new Set(sectionIds)];
    if (!unique.length) {
      throw new ApiError('VALIDATION', 'Tick at least one class for this room', 400, 'classSectionIds');
    }

    const sections = await withTenant(schoolId, (tx) =>
      tx.classSection.findMany({
        where: { schoolId, id: { in: unique } },
        include: {
          grade: { select: { name: true, order: true } },
          students: {
            where: { isActive: true },
            select: { id: true, firstName: true, lastName: true, rollNo: true },
            orderBy: { rollNo: 'asc' },
          },
        },
      }),
    );

    if (sections.length !== unique.length) {
      throw new ApiError('NOT_FOUND', 'One of those classes no longer exists', 404, 'classSectionIds');
    }

    const byId = new Map(sections.map((s) => [s.id, s]));
    return unique.map((id) => {
      const s = byId.get(id)!;
      return {
        id: s.id,
        label: `${s.grade.name}-${s.name}`,
        // `Grade.order` is the school's own sequence; `Grade.name` is free text
        // ("Class 9", "IX", "Nursery"), so it cannot be parsed into a number.
        // Order is what "these two grades write different papers" means here.
        grade: s.grade.order,
        students: s.students.map((st) => ({
          id: st.id,
          name: `${st.firstName} ${st.lastName}`.trim(),
          roll: st.rollNo === null ? null : Number.parseInt(st.rollNo, 10) || null,
        })),
      };
    });
  }

  private async loadRoom(schoolId: string, roomId: string) {
    const room = await withTenant(schoolId, (tx) => tx.room.findFirst({ where: { id: roomId, schoolId } }));
    if (!room) throw new NotFoundException('Room not found');
    return room;
  }

  /**
   * Generates a chart without saving it. The office presses the button, looks
   * at the hall, and only then decides — so nothing is written until Save.
   */
  async preview(schoolId: string, dto: PreviewSeatingDto): Promise<SeatingPlanResult> {
    const room = await this.loadRoom(schoolId, dto.roomId);
    const classes = await this.loadClasses(schoolId, dto.classSectionIds);
    const rules = SeatingService.rules(dto.rules);

    const out = generateSeating(
      classes,
      {
        rows: room.rows,
        cols: room.cols,
        seatsPerDesk: room.seatsPerDesk,
        removedDesks: room.removedDesks,
      },
      rules,
      dto.seed ?? 11,
    );

    return {
      roomId: room.id,
      roomName: room.name,
      title: dto.title?.trim() || 'Exam seating',
      classSectionIds: dto.classSectionIds,
      rules,
      seed: out.seed,
      seats: out.seats,
      report: out.report,
    };
  }

  /**
   * Saves a plan by REGENERATING it from the seed, not by trusting the seats
   * the browser sends back. Same inputs, same seed, same hall — so the
   * round-trip is free, and a tampered or stale payload cannot write a chart
   * that seats a child from another school.
   */
  async save(schoolId: string, dto: SaveSeatingDto, userId?: string): Promise<SavedSeatingPlan> {
    const result = await this.preview(schoolId, dto);
    const room = await this.loadRoom(schoolId, dto.roomId);

    const row = await withTenant(schoolId, (tx) =>
      tx.seatingPlan.create({
        data: {
          schoolId,
          roomId: room.id,
          title: result.title,
          classSectionIds: result.classSectionIds,
          rules: result.rules as unknown as object,
          seed: result.seed,
          seats: result.seats as unknown as object,
          report: result.report as unknown as object,
          createdById: userId ?? null,
        },
      }),
    );

    return {
      ...result,
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      room: {
        rows: room.rows,
        cols: room.cols,
        seatsPerDesk: room.seatsPerDesk,
        removedDesks: room.removedDesks,
      },
    };
  }

  /** Newest first — the office almost always wants the one it just made. */
  async list(schoolId: string): Promise<SeatingPlanSummary[]> {
    const rows = await withTenant(schoolId, (tx) =>
      tx.seatingPlan.findMany({
        where: { schoolId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { room: { select: { name: true } } },
      }),
    );

    return rows.map((r) => ({
      id: r.id,
      roomId: r.roomId,
      roomName: r.room.name,
      title: r.title,
      classSectionIds: r.classSectionIds,
      seated: (r.report as { seated?: number } | null)?.seated ?? 0,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * A saved plan is returned exactly as it was written, including the room
   * shape at the time. A room edited afterwards must not silently redraw a
   * chart the school has already printed and pasted onto desks.
   */
  async get(schoolId: string, id: string): Promise<SavedSeatingPlan> {
    const row = await withTenant(schoolId, (tx) =>
      tx.seatingPlan.findFirst({ where: { id, schoolId }, include: { room: true } }),
    );
    if (!row) throw new NotFoundException('Seating plan not found');

    return {
      id: row.id,
      roomId: row.roomId,
      roomName: row.room.name,
      title: row.title,
      classSectionIds: row.classSectionIds,
      rules: SeatingService.rules(row.rules as Partial<SeatingRules>),
      seed: row.seed,
      // Prisma types a JSON column as JsonValue, which does not overlap the
      // shape we wrote, so the cast goes through `unknown`. Safe because this
      // service is the only writer and `save()` regenerates before storing.
      seats: row.seats as unknown as SavedSeatingPlan['seats'],
      report: row.report as unknown as SavedSeatingPlan['report'],
      createdAt: row.createdAt.toISOString(),
      room: {
        rows: row.room.rows,
        cols: row.room.cols,
        seatsPerDesk: row.room.seatsPerDesk,
        removedDesks: row.room.removedDesks,
      },
    };
  }

  async remove(schoolId: string, id: string): Promise<{ ok: true }> {
    return withTenant(schoolId, async (tx) => {
      try {
        await tx.seatingPlan.delete({ where: { id } });
        return { ok: true as const };
      } catch (e) {
        if (isP2025(e)) throw new NotFoundException('Seating plan not found');
        throw e;
      }
    });
  }
}
