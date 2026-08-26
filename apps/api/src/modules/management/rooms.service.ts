import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { DEFAULT_SEATING_RULES, type RoomRow } from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { isP2002, isP2025 } from '../../common/errors/prisma-errors';
import { roomCapacity } from './seating-engine';
import type { SaveRoomDto } from './management.dto';

/** A room bigger than this is not a room — it is a typo, and it would render as one. */
const MAX_ROWS = 20;
const MAX_COLS = 30;

interface RoomRecord {
  id: string;
  name: string;
  rows: number;
  cols: number;
  seatsPerDesk: number;
  removedDesks: string[];
  _count?: { seatingPlans: number };
}

@Injectable()
export class RoomsService {
  /**
   * `capacity` is computed with the back-row rule ON, because that is the
   * number the office is actually deciding against ("will Class 9 fit in Hall
   * A?"). A plan generated with the rule off simply reports a larger one.
   */
  private static toRow(r: RoomRecord): RoomRow {
    return {
      id: r.id,
      name: r.name,
      rows: r.rows,
      cols: r.cols,
      seatsPerDesk: r.seatsPerDesk,
      removedDesks: r.removedDesks,
      capacity: roomCapacity(
        { rows: r.rows, cols: r.cols, seatsPerDesk: r.seatsPerDesk, removedDesks: r.removedDesks },
        DEFAULT_SEATING_RULES,
      ),
      planCount: r._count?.seatingPlans ?? 0,
    };
  }

  /**
   * Rejects a shape the seating screen could not draw, and a `removedDesks`
   * entry that points outside the grid. The second one matters more than it
   * looks: shrinking a room in the editor leaves stale "row:col" strings
   * behind, and a stale entry silently removes a desk that IS there.
   */
  private static clean(dto: SaveRoomDto): {
    name: string;
    rows: number;
    cols: number;
    seatsPerDesk: number;
    removedDesks: string[];
  } {
    const rows = Math.trunc(dto.rows);
    const cols = Math.trunc(dto.cols);
    const seatsPerDesk = Math.trunc(dto.seatsPerDesk ?? 1);

    if (rows < 1 || rows > MAX_ROWS) {
      throw new ApiError('VALIDATION', `Rows must be between 1 and ${MAX_ROWS}`, 400, 'rows');
    }
    if (cols < 1 || cols > MAX_COLS) {
      throw new ApiError('VALIDATION', `Desks in a row must be between 1 and ${MAX_COLS}`, 400, 'cols');
    }
    if (seatsPerDesk !== 1 && seatsPerDesk !== 2) {
      throw new ApiError('VALIDATION', 'A desk seats one student or two', 400, 'seatsPerDesk');
    }

    const name = dto.name.trim();
    if (!name) throw new ApiError('VALIDATION', 'Give the room a name', 400, 'name');

    const removedDesks = [...new Set(dto.removedDesks ?? [])].filter((k) => {
      const [r, c] = k.split(':').map((n) => Number.parseInt(n, 10));
      return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < rows && c >= 0 && c < cols;
    });

    return { name, rows, cols, seatsPerDesk, removedDesks };
  }

  async list(schoolId: string): Promise<RoomRow[]> {
    const rows = await withTenant(schoolId, (tx) =>
      tx.room.findMany({
        where: { schoolId },
        orderBy: { name: 'asc' },
        include: { _count: { select: { seatingPlans: true } } },
      }),
    );
    return rows.map(RoomsService.toRow);
  }

  async create(schoolId: string, dto: SaveRoomDto): Promise<RoomRow> {
    const data = RoomsService.clean(dto);
    try {
      const row = await withTenant(schoolId, (tx) => tx.room.create({ data: { ...data, schoolId } }));
      return RoomsService.toRow(row);
    } catch (e) {
      if (isP2002(e)) {
        throw new ApiError('ROOM_NAME_TAKEN', `There is already a room called ${data.name}`, 409, 'name');
      }
      throw e;
    }
  }

  async update(schoolId: string, id: string, dto: SaveRoomDto): Promise<RoomRow> {
    const data = RoomsService.clean(dto);
    try {
      const row = await withTenant(schoolId, (tx) =>
        tx.room.update({
          where: { id },
          data,
          include: { _count: { select: { seatingPlans: true } } },
        }),
      );
      return RoomsService.toRow(row);
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Room not found');
      if (isP2002(e)) {
        throw new ApiError('ROOM_NAME_TAKEN', `There is already a room called ${data.name}`, 409, 'name');
      }
      throw e;
    }
  }

  /**
   * Copying a room is the whole reason room setup takes minutes and not an
   * afternoon: a school has fourteen classrooms of the same shape. The copy
   * carries the layout and the missing desks, never the seating plans.
   */
  async duplicate(schoolId: string, id: string): Promise<RoomRow> {
    const source = await withTenant(schoolId, (tx) => tx.room.findFirst({ where: { id, schoolId } }));
    if (!source) throw new NotFoundException('Room not found');

    const taken = new Set(
      (await withTenant(schoolId, (tx) => tx.room.findMany({ where: { schoolId }, select: { name: true } }))).map(
        (r) => r.name,
      ),
    );
    let name = `${source.name} copy`;
    for (let n = 2; taken.has(name); n++) name = `${source.name} copy ${n}`;

    const row = await withTenant(schoolId, (tx) =>
      tx.room.create({
        data: {
          schoolId,
          name,
          rows: source.rows,
          cols: source.cols,
          seatsPerDesk: source.seatsPerDesk,
          removedDesks: source.removedDesks,
        },
      }),
    );
    return RoomsService.toRow(row);
  }

  /**
   * Deleting a room cascades its seating plans away. That is right for a room
   * recorded by mistake and wrong for one the office has already printed from,
   * so a room with plans has to be emptied deliberately first.
   */
  async remove(schoolId: string, id: string): Promise<{ ok: true }> {
    const plans = await withTenant(schoolId, (tx) => tx.seatingPlan.count({ where: { schoolId, roomId: id } }));
    if (plans > 0) {
      throw new ApiError(
        'ROOM_IN_USE',
        `This room has ${plans} saved seating plan${plans === 1 ? '' : 's'}. Delete those first.`,
        409,
      );
    }
    return withTenant(schoolId, async (tx) => {
      try {
        await tx.room.delete({ where: { id } });
        return { ok: true as const };
      } catch (e) {
        if (isP2025(e)) throw new NotFoundException('Room not found');
        throw e;
      }
    });
  }
}
