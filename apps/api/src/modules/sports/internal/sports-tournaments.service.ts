import { Injectable } from '@nestjs/common';
import { Prisma, withTenant, type TenantTx } from '@skoolos/db';
import {
  AGE_GROUPS, ageGroupFor, assertNotificationKind, assertNotificationOutboxKind, bandFor, buildDraw, cursorFrom, customSport, dayOf, finalists,
  advanceFrom, dayFloor, groupLabel as groupLabelOf, hhmm, inferVenueType, newDiary, parseSide, planHeats, planStages, resolveSport, shuffle, sideOfEntry, sidesAreSections, sportByKey, stdOfGrade, suggestTeamBasis, venuesForSport,
  type Band, type DayWindow, type HeatKind, type Scoring, type Sport, type StageShape, type TeamBasis, type VenueType,
} from '@skoolos/types';
import { ApiError } from '../../../common/errors/api-error';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { activeStudentsWhere } from '../../../common/roster/active-students';
import { buildEventPlan, classLabel, drawToMatches, peopleOfSide, scheduleHeats, scheduleMatches, seedOf, type EntryIn, type HeatPlan, type MatchPlan } from './sports-build';
import { SportsSettingsService } from './sports-settings.service';
import type { AddVenueDto, CreateTournamentDto, EventInDto, MoveSlotDto, PinEventDto, ShiftDto, UpdateTournamentDto } from './sports.dto';

export interface TournamentRow { id: string; name: string; startsOn: string; endsOn: string; status: string; published: boolean; version: number; events: number }
export interface RosterStudent { id: string; name: string; std: number; section: string; gender: string | null; dob: string | null; houseId: string | null }

export interface MatchRow {
  id: string; stage: string; groupLabel: string; roundIdx: number; roundName: string; pos: number; aSide: string | null; bSide: string | null;
  scoreA: number[]; scoreB: number[]; winner: string | null; bye: boolean; walkover: boolean; venueId: string | null; atMin: number | null; version: number; savedAt: Date | null;
}
export interface HeatRow { id: string; kind: HeatKind; groupLabel: string | null; idx: number; venueId: string | null; atMin: number | null; done: boolean; marks: { studentId: string; side: string; lane: number; mark: number | null; rank: number | null }[] }
export interface EventDetail {
  id: string; sportKey: string; sportName: string; kind: string; scoring: Scoring; teamSize: number; groupKey: string; groupLabel: string; category: string;
  structure: string; teamBasis: TeamBasis; stageShape: StageShape; advancePerClass: number; finalists: number; dayIdx: number | null; slotMin: number; lanes: number; venueIds: string[]; order: number;
  entries: { studentId: string; side: string; std: number; section: string; houseId: string | null }[];
  matches: MatchRow[]; heats: HeatRow[];
}
export interface TournamentDetail {
  id: string; name: string; startsOn: string; endsOn: string; grouping: string; dayStartMin: number; dayEndMin: number; restMin: number; status: string; published: boolean; version: number;
  venues: { id: string; name: string; order: number }[]; events: EventDetail[]; sideNames: Record<string, string>; bands: Band[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dateOf = (s: string) => new Date(`${s}T00:00:00Z`);
const MAX_DAYS = 14;

/**
 * Tournaments — several sports on shared venues and days (spec §4). A meet is
 * created in ONE transaction from the wizard: venues, events, entries, the
 * class draws (or one draw), heats with lanes, and every slot on a venue. A
 * band final or a heats final is added later, by `ensureFinal` /
 * `ensureHeatFinal`, the moment the last class champion or the last heat is
 * in — so the desk never builds it by hand and two desks cannot build it twice.
 *
 * Reads are one `get` per screen: the board, the bracket, the clashes and the
 * day view are all derived on the client from that one payload with the
 * shared maths, so every desk sees the same truth without a session.
 */
@Injectable()
export class SportsTournamentsService {
  constructor(private readonly settings: SportsSettingsService) {}

  list(schoolId: string): Promise<TournamentRow[]> {
    return withTenant(schoolId, async (tx) => {
      const [rows, counts] = await Promise.all([
        tx.sportsTournament.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId }, orderBy: [{ startsOn: 'desc' }, { createdAt: 'desc' }] }),
        tx.sportsEvent.groupBy({ by: ['tournamentId'], where: { schoolId }, _count: { _all: true } }),
      ]);
      const n = new Map(counts.map((c) => [c.tournamentId, c._count._all]));
      return rows.map((t) => ({ id: t.id, name: t.name, startsOn: iso(t.startsOn), endsOn: iso(t.endsOn), status: t.status, published: t.published, version: t.version, events: n.get(t.id) ?? 0 }));
    });
  }

  /** Everyone on the active roll in a numbered class — the wizard's picker. */
  roster(schoolId: string): Promise<RosterStudent[]> {
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.student.findMany({
        take: LIST_CEILING.ROSTER,
        where: activeStudentsWhere(schoolId, { classSectionId: { not: null } }),
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        select: { id: true, firstName: true, lastName: true, gender: true, dob: true, houseId: true, classSection: { select: { name: true, grade: { select: { name: true, order: true } } } } },
      });
      const out: RosterStudent[] = [];
      for (const s of rows) {
        const std = s.classSection ? stdOfGrade(s.classSection.grade) : null;
        if (std == null || !s.classSection) continue;
        out.push({ id: s.id, name: `${s.firstName} ${s.lastName}`.trim(), std, section: s.classSection.name, gender: s.gender, dob: s.dob ? iso(s.dob) : null, houseId: s.houseId });
      }
      return out;
    });
  }

  async create(schoolId: string, actorId: string, dto: CreateTournamentDto): Promise<{ id: string; days: number; daysNeeded: number; warnings: string[] }> {
    const days = Math.round((dateOf(dto.endsOn).getTime() - dateOf(dto.startsOn).getTime()) / 86_400_000) + 1;
    if (!(days >= 1)) throw new ApiError('VALIDATION', 'The last day cannot be before the first.', 400, 'endsOn');
    if (days > MAX_DAYS) throw new ApiError('VALIDATION', `A meet runs for at most ${MAX_DAYS} days.`, 400, 'endsOn');
    const dayStartMin = dto.dayStartMin ?? 540;
    const dayEndMin = dto.dayEndMin ?? 960;
    if (dayEndMin - dayStartMin < 60) throw new ApiError('VALIDATION', 'A day needs at least an hour.', 400, 'dayEndMin');
    const venueNames = dto.venues.map((v) => v.name.trim());
    if (new Set(venueNames.map((n) => n.toLowerCase())).size !== venueNames.length) throw new ApiError('VALIDATION', 'Two venues have the same name.', 400, 'venues');
    const sports: Sport[] = dto.events.map((ev, i) => {
      const sport = ev.sportKey === 'custom' ? customSport(ev.customName ?? '', ev.presetKey ?? '', ev.teamSize ?? 1, ev.customVenue as VenueType | undefined) : sportByKey(ev.sportKey);
      if (!sport) throw new ApiError('UNKNOWN_SPORT', `Event ${i + 1}: that sport is not in the catalogue.`, 400, `events.${i}.sportKey`);
      if (ev.venueIdx.some((v) => v >= venueNames.length)) throw new ApiError('VALIDATION', `Event ${i + 1} points at a venue that is not in the list.`, 400, `events.${i}.venueIdx`);
      return sport;
    });

    return withTenant(schoolId, async (tx) => {
      const settings = this.settings.view(await this.settings.ensure(tx, schoolId));
      const meetYear = Number(dto.startsOn.slice(0, 4));
      const ids = [...new Set(dto.events.flatMap((e) => e.studentIds))];
      const students = await tx.student.findMany({
        take: LIST_CEILING.ROSTER,
        where: activeStudentsWhere(schoolId, { id: { in: ids } }),
        select: { id: true, firstName: true, lastName: true, dob: true, houseId: true, classSection: { select: { name: true, grade: { select: { name: true, order: true } } } } },
      });
      const byId = new Map(students.map((s) => [s.id, s]));
      const missing = ids.filter((id) => !byId.has(id)).length;
      if (missing) throw new ApiError('VALIDATION', `${missing} chosen ${missing === 1 ? 'student is' : 'students are'} not on the active roll. Reload the roster and pick again.`, 400, 'events');
      const placed = new Map<string, EntryIn & { name: string; dob: Date | null }>();
      for (const s of students) {
        const std = s.classSection ? stdOfGrade(s.classSection.grade) : null;
        if (std == null || !s.classSection) throw new ApiError('VALIDATION', `${s.firstName} ${s.lastName} is in "${s.classSection?.grade.name ?? 'no class'}", which has no class number.`, 400, 'events');
        placed.set(s.id, { studentId: s.id, std, section: s.classSection.name, houseId: s.houseId, name: `${s.firstName} ${s.lastName}`.trim(), dob: s.dob });
      }
      dto.events.forEach((ev, i) => this.checkGroup(ev, i, settings.grouping, settings.bands, meetYear, placed));
      // Plan every event (pure) before the first write, so a bad event costs no rows.
      const plans = dto.events.map((ev, i) => {
        const sport = sports[i];
        const entries = [...new Set(ev.studentIds)].map((id) => placed.get(id)!);
        const basis: TeamBasis = sidesAreSections(sport) ? ev.teamBasis ?? suggestTeamBasis(entries) : 'SECTIONS';
        const shape: StageShape = ev.stageShape ?? 'STRAIGHT';
        if (basis === 'HOUSES' && entries.every((e) => !e.houseId)) throw new ApiError('SPORTS_NEED_TWO', `${sport.name}: none of the entered children is in a house yet. Put them in houses first, or pick sections or classes as the teams.`, 400, `events.${i}.teamBasis`);
        try {
          return { entries, basis, shape, plan: buildEventPlan(sport, ev.structure, entries, seedOf(`${dto.name.trim()}:${i}`), basis, { shape, lanes: ev.lanes ?? sport.lanes ?? 6 }) };
        } catch {
          const what = !sidesAreSections(sport) ? 'players' : basis === 'CLASSES' ? 'classes' : basis === 'HOUSES' ? 'houses' : 'sections (or pick classes as the teams)';
          throw new ApiError('SPORTS_NEED_TWO', `${sport.name} (${groupLabelOf(settings.grouping, settings.bands, ev.groupKey)} ${ev.category}) needs at least two ${what}.`, 400, `events.${i}.studentIds`);
        }
      });

      const t = await tx.sportsTournament.create({
        data: { schoolId, name: dto.name.trim(), startsOn: dateOf(dto.startsOn), endsOn: dateOf(dto.endsOn), grouping: settings.grouping, dayStartMin, dayEndMin, restMin: dto.restMin ?? 15, createdById: actorId },
        select: { id: true },
      });
      await tx.sportsVenue.createMany({ data: venueNames.map((name, order) => ({ schoolId, tournamentId: t.id, name, order })) });
      const venueRows = await tx.sportsVenue.findMany({ where: { schoolId, tournamentId: t.id }, orderBy: { order: 'asc' }, select: { id: true } });
      const w: DayWindow = { dayStartMin, dayEndMin, days };
      const cursor = new Map(venueRows.map((v) => [v.id, dayStartMin]));
      // one diary for the whole meet: a child in two events is never in two places at once
      const diary = newDiary(dto.restMin ?? 15);
      let maxEnd = 0;
      for (const [i, ev] of dto.events.entries()) {
        const sport = sports[i];
        const { entries, plan, basis, shape } = plans[i];
        const venueIds = ev.venueIdx.map((idx) => venueRows[idx].id);
        const slotMin = ev.slotMin ?? sport.slotMin;
        const lanes = ev.lanes ?? sport.lanes ?? 6;
        const pin = ev.dayIdx != null ? dayFloor(Math.min(ev.dayIdx, days - 1), w) : 0;
        if (plan.matches.length) scheduleMatches(plan.matches, venueIds, slotMin, cursor, w, diary, (side) => peopleOfSide(side, sport, entries, basis), pin);
        if (plan.heats.length) scheduleHeats(plan.heats, venueIds, slotMin, cursor, w, diary, pin);
        const structure = sport.kind === 'MEASURED' ? 'HEATS' : sport.kind === 'JUDGED' ? 'PANEL' : plan.walkovers.length || plan.matches.some((m) => m.stage === 'CLASS') ? 'CLASS' : 'DRAW';
        const event = await tx.sportsEvent.create({
          data: {
            schoolId, tournamentId: t.id, sportKey: sport.key, sportName: sport.name, kind: sport.kind, groupKey: ev.groupKey, category: ev.category, structure, teamBasis: basis,
            stageShape: shape, advancePerClass: ev.advancePerClass ?? 2, finalists: ev.finalists ?? 6, dayIdx: ev.dayIdx ?? null, slotMin, lanes, venueIds, order: i,
          },
          select: { id: true },
        });
        await tx.sportsEntry.createMany({ data: entries.map((e) => ({ schoolId, eventId: event.id, studentId: e.studentId, std: e.std, section: e.section })) });
        if (plan.matches.length) await tx.sportsMatch.createMany({ data: plan.matches.map((m) => matchData(schoolId, event.id, m)) });
        for (const h of plan.heats) {
          await tx.sportsHeat.create({
            data: {
              schoolId, eventId: event.id, kind: h.kind, groupLabel: h.groupLabel ?? null, idx: h.idx, venueId: h.venueId, atMin: h.atMin,
              marks: { createMany: { data: h.lanes.map((l) => ({ schoolId, studentId: studentOf(l.side), lane: l.lane })) } },
            },
          });
        }
        for (const m of plan.matches) if (m.atMin != null) maxEnd = Math.max(maxEnd, m.atMin + slotMin);
        for (const h of plan.heats) if (h.atMin != null) maxEnd = Math.max(maxEnd, h.atMin + slotMin);
      }
      const daysNeeded = maxEnd ? dayOf(maxEnd - 1) + 1 : 1;
      const warnings: string[] = [];
      if (daysNeeded > days) warnings.push(`The plan needs ${daysNeeded} days on these venues; the meet has ${days}. Add a day or a venue, or shorten the slots.`);
      return { id: t.id, days, daysNeeded, warnings };
    });
  }

  private checkGroup(ev: EventInDto, i: number, grouping: 'BANDS' | 'AGE', bands: Band[], meetYear: number, placed: Map<string, EntryIn & { name: string; dob: Date | null }>): void {
    const field = `events.${i}.studentIds`;
    if (grouping === 'AGE') {
      if (!AGE_GROUPS.some((g) => g.id === ev.groupKey)) throw new ApiError('VALIDATION', `Event ${i + 1}: unknown age group.`, 400, `events.${i}.groupKey`);
    } else if (!bands.some((b) => b.id === ev.groupKey)) throw new ApiError('VALIDATION', `Event ${i + 1}: unknown band.`, 400, `events.${i}.groupKey`);
    const label = groupLabelOf(grouping, bands, ev.groupKey);
    for (const id of ev.studentIds) {
      const s = placed.get(id)!;
      if (grouping === 'AGE') {
        if (!s.dob) throw new ApiError('VALIDATION', `${s.name} has no date of birth on the roll; age groups need one.`, 400, field);
        if (ageGroupFor(s.dob, meetYear)?.id !== ev.groupKey) throw new ApiError('VALIDATION', `${s.name} is not in ${label} for ${meetYear}.`, 400, field);
      } else if (bandFor(bands, s.std)?.id !== ev.groupKey) throw new ApiError('VALIDATION', `${s.name} (class ${s.std}) is not in ${label}.`, 400, field);
    }
  }

  get(schoolId: string, id: string): Promise<TournamentDetail> {
    return withTenant(schoolId, (tx) => this.getIn(tx, schoolId, id));
  }

  private async getIn(tx: TenantTx, schoolId: string, id: string): Promise<TournamentDetail> {
    {
      const t = await tx.sportsTournament.findFirst({ where: { id, schoolId } });
      if (!t) throw new ApiError('TOURNAMENT_NOT_FOUND', 'That tournament is not in this school.', 404);
      const settings = this.settings.view(await this.settings.ensure(tx, schoolId));
      const [venues, events] = await Promise.all([
        tx.sportsVenue.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, tournamentId: id }, orderBy: { order: 'asc' }, select: { id: true, name: true, order: true } }),
        tx.sportsEvent.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, tournamentId: id }, orderBy: { order: 'asc' } }),
      ]);
      const eventIds = events.map((e) => e.id);
      const [entries, matches, heats, houses] = await Promise.all([
        tx.sportsEntry.findMany({
          take: LIST_CEILING.ROSTER, where: { schoolId, eventId: { in: eventIds } },
          select: { eventId: true, studentId: true, std: true, section: true, student: { select: { firstName: true, lastName: true, houseId: true } } },
        }),
        tx.sportsMatch.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, eventId: { in: eventIds } }, orderBy: [{ stage: 'asc' }, { groupLabel: 'asc' }, { roundIdx: 'asc' }, { pos: 'asc' }] }),
        tx.sportsHeat.findMany({
          take: LIST_CEILING.ACTIVITY, where: { schoolId, eventId: { in: eventIds } }, orderBy: [{ kind: 'desc' }, { idx: 'asc' }],
          select: { id: true, eventId: true, kind: true, groupLabel: true, idx: true, venueId: true, atMin: true, done: true, marks: { select: { studentId: true, lane: true, mark: true, rank: true }, orderBy: { lane: 'asc' } } },
        }),
        tx.house.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId }, select: { id: true, name: true } }),
      ]);
      const sideNames: Record<string, string> = {};
      for (const e of entries) {
        sideNames[`s:${e.studentId}`] = `${e.student.firstName} ${e.student.lastName}`.trim();
        sideNames[`c:${e.std}-${e.section.trim().toUpperCase()}`] = `${e.std} ${e.section}`;
        sideNames[`k:${e.std}`] = `Class ${e.std}`;
      }
      for (const h of houses) sideNames[`h:${h.id}`] = h.name;
      const detail: EventDetail[] = events.map((ev) => {
        const sport = resolveSport(ev.sportKey, ev.sportName);
        return {
          id: ev.id, sportKey: ev.sportKey, sportName: ev.sportName, kind: ev.kind, scoring: sport?.scoring ?? { type: 'SINGLE', label: 'Points', decider: 'Decider' }, teamSize: sport?.teamSize ?? 1,
          groupKey: ev.groupKey, groupLabel: groupLabelOf(t.grouping === 'AGE' ? 'AGE' : 'BANDS', settings.bands, ev.groupKey), category: ev.category, structure: ev.structure, teamBasis: ev.teamBasis as TeamBasis,
          stageShape: ev.stageShape as StageShape, advancePerClass: ev.advancePerClass, finalists: ev.finalists, dayIdx: ev.dayIdx,
          slotMin: ev.slotMin, lanes: ev.lanes, venueIds: ev.venueIds, order: ev.order,
          entries: entries.filter((e) => e.eventId === ev.id).map((e) => ({
            studentId: e.studentId, side: sideOfEntry({ studentId: e.studentId, std: e.std, section: e.section, houseId: e.student.houseId }, !!sport && sidesAreSections(sport), ev.teamBasis as TeamBasis) ?? `s:${e.studentId}`, std: e.std, section: e.section, houseId: e.student.houseId,
          })),
          matches: matches.filter((m) => m.eventId === ev.id).map((m) => ({
            id: m.id, stage: m.stage, groupLabel: m.groupLabel, roundIdx: m.roundIdx, roundName: m.roundName, pos: m.pos, aSide: m.aSide, bSide: m.bSide, scoreA: m.scoreA, scoreB: m.scoreB,
            winner: m.winner, bye: m.bye, walkover: m.walkover, venueId: m.venueId, atMin: m.atMin, version: m.version, savedAt: m.savedAt,
          })),
          heats: heats.filter((h) => h.eventId === ev.id).map((h) => ({
            id: h.id, kind: h.kind as HeatKind, groupLabel: h.groupLabel, idx: h.idx, venueId: h.venueId, atMin: h.atMin, done: h.done,
            marks: h.marks.map((k) => ({ studentId: k.studentId, side: `s:${k.studentId}`, lane: k.lane, mark: k.mark, rank: k.rank })),
          })),
        };
      });
      return {
        id: t.id, name: t.name, startsOn: iso(t.startsOn), endsOn: iso(t.endsOn), grouping: t.grouping, dayStartMin: t.dayStartMin, dayEndMin: t.dayEndMin, restMin: t.restMin, status: t.status, published: t.published, version: t.version,
        venues, events: detail, sideNames, bands: settings.bands,
      };
    }
  }

  /** DRAFT → LIVE and visible to students; every entered child with a login gets one bell + one push naming their first slot. */
  publish(schoolId: string, id: string, isAdmin: boolean): Promise<{ notified: number }> {
    assertNotificationKind('SPORTS');
    assertNotificationOutboxKind('SPORTS_NOTICE');
    return withTenant(schoolId, async (tx) => {
      const t = await this.requireTournament(tx, schoolId, id);
      if (t.status === 'DONE') throw new ApiError('TOURNAMENT_STATE', 'This tournament is finished.', 409);
      const settings = await this.settings.ensure(tx, schoolId);
      if (settings.publishNeedsAdmin && !isAdmin) throw new ApiError('SPORTS_PERM', 'Publishing needs a school admin at this school.', 403);
      const wasPublished = t.published;
      await tx.sportsTournament.update({ where: { id }, data: { status: 'LIVE', published: true, version: { increment: 1 } } });
      if (wasPublished) return { notified: 0 };

      const [school, venues, events, entries, matches, heats] = await Promise.all([
        tx.school.findUnique({ where: { id: schoolId }, select: { name: true } }),
        tx.sportsVenue.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, tournamentId: id }, select: { id: true, name: true } }),
        tx.sportsEvent.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, tournamentId: id }, select: { id: true, sportName: true, groupKey: true, category: true, kind: true, sportKey: true, teamBasis: true } }),
        tx.sportsEntry.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId, event: { tournamentId: id } }, select: { eventId: true, studentId: true, std: true, section: true, student: { select: { userId: true, firstName: true, houseId: true } } } }),
        tx.sportsMatch.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, event: { tournamentId: id }, bye: false, atMin: { not: null } }, select: { eventId: true, aSide: true, bSide: true, roundName: true, groupLabel: true, venueId: true, atMin: true } }),
        tx.sportsHeat.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, event: { tournamentId: id }, atMin: { not: null } }, select: { eventId: true, kind: true, idx: true, venueId: true, atMin: true, marks: { select: { studentId: true } } } }),
      ]);
      const venueName = new Map(venues.map((v) => [v.id, v.name]));
      const eventById = new Map(events.map((e) => [e.id, e]));
      const view = this.settings.view(settings);
      // first slot per student
      const first = new Map<string, { atMin: number; line: string }>();
      const consider = (studentId: string, atMin: number | null, line: string) => {
        if (atMin == null) return;
        const cur = first.get(studentId);
        if (!cur || atMin < cur.atMin) first.set(studentId, { atMin, line });
      };
      const eventsOf = new Map<string, number>();
      for (const e of entries) eventsOf.set(e.studentId, (eventsOf.get(e.studentId) ?? 0) + 1);
      const when = (atMin: number) => `${dayLabel(t.startsOn, dayOf(atMin))} ${hhmm(atMin)}`;
      for (const m of matches) {
        const ev = eventById.get(m.eventId);
        if (!ev) continue;
        const sport = resolveSport(ev.sportKey, ev.sportName);
        const line = `${ev.sportName}: ${m.roundName}${m.groupLabel !== 'Final' ? ` (${m.groupLabel})` : ''}, ${when(m.atMin!)} at ${venueName.get(m.venueId ?? '') ?? 'the venue'}`;
        for (const side of [m.aSide, m.bSide]) {
          if (!side) continue;
          const p = parseSide(side);
          if (p?.kind === 'student') consider(p.studentId, m.atMin, line);
          else if (p && sport) for (const e of entries) if (e.eventId === ev.id && sideOfEntry({ studentId: e.studentId, std: e.std, section: e.section, houseId: e.student.houseId }, true, ev.teamBasis as TeamBasis) === side) consider(e.studentId, m.atMin, line);
        }
      }
      for (const h of heats) {
        const ev = eventById.get(h.eventId);
        if (!ev) continue;
        const line = `${ev.sportName}: ${h.kind === 'FINAL' ? 'Final' : `Heat ${h.idx + 1}`}, ${when(h.atMin!)} at ${venueName.get(h.venueId ?? '') ?? 'the venue'}`;
        for (const k of h.marks) consider(k.studentId, h.atMin, line);
      }
      const rows: Prisma.NotificationCreateManyInput[] = [];
      const pushes: Prisma.NotificationOutboxCreateManyInput[] = [];
      const seen = new Set<string>();
      for (const e of entries) {
        const userId = e.student.userId;
        if (!userId || seen.has(e.studentId)) continue;
        seen.add(e.studentId);
        const n = eventsOf.get(e.studentId) ?? 1;
        const slot = first.get(e.studentId);
        const title = `${t.name}: you're in`;
        const body = `${n === 1 ? 'One event' : `${n} events`}. ${slot ? `First: ${slot.line}.` : 'Times will follow.'}`;
        rows.push({ schoolId, userId, kind: 'SPORTS', title, body, linkType: 'sports', linkId: id });
        pushes.push({ schoolId, kind: 'SPORTS_NOTICE', targetUserId: userId, payload: { schoolName: school?.name ?? '', title, body, tournamentId: id } as unknown as Prisma.InputJsonValue });
      }
      void view;
      for (const part of chunks(rows, 1000)) await tx.notification.createMany({ data: part });
      for (const part of chunks(pushes, 1000)) await tx.notificationOutbox.createMany({ data: part });
      return { notified: rows.length };
    });
  }

  finish(schoolId: string, id: string): Promise<void> {
    return withTenant(schoolId, async (tx) => {
      const t = await this.requireTournament(tx, schoolId, id);
      if (t.status !== 'LIVE') throw new ApiError('TOURNAMENT_STATE', 'Only a live tournament can be finished.', 409);
      await tx.sportsTournament.update({ where: { id }, data: { status: 'DONE', version: { increment: 1 } } });
    });
  }

  /** A draft can be thrown away and rebuilt; a live or finished meet is history. */
  remove(schoolId: string, id: string): Promise<void> {
    return withTenant(schoolId, async (tx) => {
      const t = await this.requireTournament(tx, schoolId, id);
      if (t.status !== 'DRAFT') throw new ApiError('TOURNAMENT_STATE', 'Only a draft can be deleted. A live tournament can be finished.', 409);
      await tx.sportsTournament.delete({ where: { id } });
    });
  }

  /** Drag one slot on the board. */
  move(schoolId: string, id: string, kind: 'match' | 'heat', slotId: string, dto: MoveSlotDto): Promise<void> {
    return withTenant(schoolId, async (tx) => {
      await this.requireTournament(tx, schoolId, id);
      if (dto.venueId) {
        const v = await tx.sportsVenue.findFirst({ where: { id: dto.venueId, schoolId, tournamentId: id }, select: { id: true } });
        if (!v) throw new ApiError('VALIDATION', 'That venue is not in this tournament.', 400, 'venueId');
      }
      const data = { atMin: dto.atMin, ...(dto.venueId ? { venueId: dto.venueId } : {}) };
      const where = { id: slotId, schoolId, event: { tournamentId: id } };
      const r = kind === 'match' ? await tx.sportsMatch.updateMany({ where, data }) : await tx.sportsHeat.updateMany({ where, data });
      if (r.count === 0) throw new ApiError(kind === 'match' ? 'MATCH_NOT_FOUND' : 'HEAT_NOT_FOUND', 'That slot is not in this tournament.', 404);
      await tx.sportsTournament.update({ where: { id }, data: { version: { increment: 1 } } });
    });
  }

  /** Rain delay: every unplayed slot from `fromMin` on moves by `deltaMin`, in one statement per table. */
  shift(schoolId: string, id: string, dto: ShiftDto): Promise<{ matches: number; heats: number }> {
    return withTenant(schoolId, async (tx) => {
      await this.requireTournament(tx, schoolId, id);
      const scope = { schoolId, event: { tournamentId: id, ...(dto.eventId ? { id: dto.eventId } : {}) }, atMin: { not: null, gte: dto.fromMin ?? 0 } };
      const [m, h] = await Promise.all([
        tx.sportsMatch.updateMany({ where: { ...scope, winner: null, bye: false }, data: { atMin: { increment: dto.deltaMin } } }),
        tx.sportsHeat.updateMany({ where: { ...scope, done: false }, data: { atMin: { increment: dto.deltaMin } } }),
      ]);
      await tx.sportsTournament.update({ where: { id }, data: { version: { increment: 1 } } });
      return { matches: m.count, heats: h.count };
    });
  }

  /**
   * CLASS structure: once every class has a champion (a final's winner, or a
   * lone entrant's walkover), build the band final from them and put it on
   * the venues after everything already booked. Idempotent: a final that
   * exists, or a class still playing, means nothing happens.
   */
  async ensureFinal(tx: TenantTx, schoolId: string, eventId: string): Promise<boolean> {
    const ev = await tx.sportsEvent.findFirst({ where: { id: eventId, schoolId }, select: { id: true, tournamentId: true, structure: true, kind: true, slotMin: true, venueIds: true, sportKey: true, sportName: true, teamBasis: true, dayIdx: true } });
    if (!ev || ev.kind !== 'MATCH' || ev.structure !== 'CLASS') return false;
    const [matches, entries] = await Promise.all([
      tx.sportsMatch.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, eventId }, select: { stage: true, groupLabel: true, roundIdx: true, winner: true } }),
      tx.sportsEntry.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId, eventId }, select: { studentId: true, std: true, section: true, student: { select: { houseId: true } } } }),
    ]);
    if (matches.some((m) => m.stage === 'FINAL')) return false;
    const sport = resolveSport(ev.sportKey, ev.sportName);
    if (!sport) return false;
    const champions: { std: number; side: string }[] = [];
    const stds = [...new Set(entries.map((e) => e.std))].sort((a, b) => a - b);
    for (const std of stds) {
      const inClass = matches.filter((m) => m.stage === 'CLASS' && m.groupLabel === classLabel(std));
      if (inClass.length === 0) {
        const sides = new Set(entries.filter((e) => e.std === std).map((e) => sideOfEntry({ studentId: e.studentId, std: e.std, section: e.section, houseId: e.student.houseId }, sidesAreSections(sport), ev.teamBasis as TeamBasis)).filter((x): x is string => !!x));
        if (sides.size !== 1) return false;
        champions.push({ std, side: [...sides][0] });
        continue;
      }
      const last = Math.max(...inClass.map((m) => m.roundIdx));
      const final = inClass.find((m) => m.roundIdx === last);
      if (!final?.winner) return false;
      champions.push({ std, side: final.winner });
    }
    if (champions.length < 2) return false;
    const { rounds } = buildDraw(shuffle(champions.map((c) => c.side), seedOf(`${eventId}:final`)));
    const plan = drawToMatches('FINAL', 'Final', rounds);
    await this.scheduleLate(tx, schoolId, ev.tournamentId, ev.venueIds, ev.slotMin, plan, [], ev.dayIdx);
    await tx.sportsMatch.createMany({ data: plan.map((m) => matchData(schoolId, eventId, m)) });
    await tx.sportsTournament.update({ where: { id: ev.tournamentId }, data: { version: { increment: 1 } } });
    return true;
  }

  /**
   * The funnel, one step at a time. When every heat of the current step is
   * ranked, the next step is built from its marks: the best of each class
   * (class qualifying), the fastest overall (open qualifying), or the fastest
   * lane-full (straight). Idempotent — a step that exists is never rebuilt and
   * a step whose heats are still open waits.
   */
  async ensureHeatFinal(tx: TenantTx, schoolId: string, eventId: string): Promise<boolean> {
    const ev = await tx.sportsEvent.findFirst({
      where: { id: eventId, schoolId },
      select: { id: true, tournamentId: true, kind: true, lanes: true, slotMin: true, venueIds: true, sportKey: true, sportName: true, stageShape: true, advancePerClass: true, finalists: true, dayIdx: true },
    });
    if (!ev || ev.kind !== 'MEASURED') return false;
    const sport = resolveSport(ev.sportKey, ev.sportName);
    if (!sport || sport.scoring.type !== 'MARK') return false;
    const lower = sport.scoring.lowerIsBetter;
    const [heats, entries] = await Promise.all([
      tx.sportsHeat.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, eventId }, select: { kind: true, groupLabel: true, done: true, marks: { select: { studentId: true, mark: true } } } }),
      tx.sportsEntry.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId, eventId }, select: { studentId: true, std: true } }),
    ]);
    if (!heats.length || heats.some((h) => h.kind === 'FINAL')) return false;
    const shape = (ev.stageShape as StageShape) ?? 'STRAIGHT';
    const steps = planStages({ entries: entries.length, classes: new Set(entries.map((e) => e.std)).size, lanes: ev.lanes, shape, advancePerClass: ev.advancePerClass, finalists: ev.finalists });
    const at: HeatKind = heats.some((h) => h.kind === 'SEMI') ? 'SEMI' : 'HEAT';
    const here = steps.findIndex((st) => st.kind === at);
    const next = here >= 0 ? steps[here + 1] : undefined;
    if (!next) return false;
    const current = heats.filter((h) => h.kind === at);
    if (!current.length || current.some((h) => !h.done)) return false;

    const marks = current.flatMap((h) => h.marks.map((k) => ({ side: `s:${k.studentId}`, mark: k.mark, groupLabel: h.groupLabel })));
    const byClass = at === 'HEAT' && shape === 'CLASS_QUAL' && current.some((h) => h.groupLabel);
    const field = byClass
      ? advanceFrom(marks, ev.advancePerClass, lower)
      : advanceFrom(marks.map((m) => ({ ...m, groupLabel: null })), next.field, lower);
    if (field.length < 2) return false;

    const shaped = next.kind === 'FINAL'
      ? [{ idx: 0, kind: 'FINAL' as const, lanes: field.slice(0, Math.max(2, ev.lanes)).map((side, i) => ({ lane: i + 1, side })) }]
      : planHeats(field, ev.lanes).map((h) => ({ ...h, kind: 'SEMI' as const }));
    const built: HeatPlan[] = shaped.map((h, i) => ({ kind: h.kind, groupLabel: null, idx: heats.length + i, venueId: null as string | null, atMin: null as number | null, lanes: h.lanes }));
    await this.scheduleLate(tx, schoolId, ev.tournamentId, ev.venueIds, ev.slotMin, [], built, ev.dayIdx);
    for (const h of built) {
      await tx.sportsHeat.create({
        data: { schoolId, eventId, kind: h.kind, groupLabel: null, idx: h.idx, venueId: h.venueId, atMin: h.atMin, marks: { createMany: { data: h.lanes.map((l) => ({ schoolId, studentId: studentOf(l.side), lane: l.lane })) } } },
      });
    }
    await tx.sportsTournament.update({ where: { id: ev.tournamentId }, data: { version: { increment: 1 } } });
    return true;
  }

  // ── growing a meet after it was created ──────────────────────

  /**
   * More days, different hours, a longer rest. A day may be added while the
   * meet is LIVE (that is the day board's "add this day"); the hours and the
   * rest gap belong to a draft, since changing them under a published
   * timetable would move slots children have already been told about.
   */
  update(schoolId: string, id: string, dto: UpdateTournamentDto): Promise<TournamentDetail> {
    return withTenant(schoolId, async (tx) => {
      const t = await this.requireTournament(tx, schoolId, id);
      if (t.status === 'DONE') throw new ApiError('TOURNAMENT_STATE', 'This tournament is finished.', 409);
      const hoursOrRest = dto.dayStartMin != null || dto.dayEndMin != null || dto.restMin != null;
      if (hoursOrRest && t.status !== 'DRAFT') throw new ApiError('TOURNAMENT_STATE', 'The hours and the rest gap can only change while the tournament is a draft. A day can still be added.', 409);
      const dayStartMin = dto.dayStartMin ?? t.dayStartMin;
      const dayEndMin = dto.dayEndMin ?? t.dayEndMin;
      if (dayEndMin - dayStartMin < 60) throw new ApiError('VALIDATION', 'A day needs at least an hour.', 400, 'dayEndMin');
      let endsOn = t.endsOn;
      if (dto.endsOn) {
        endsOn = dateOf(dto.endsOn);
        if (endsOn.getTime() < t.startsOn.getTime()) throw new ApiError('VALIDATION', 'The last day cannot be before the first.', 400, 'endsOn');
        const days = Math.round((endsOn.getTime() - t.startsOn.getTime()) / 86_400_000) + 1;
        if (days > MAX_DAYS) throw new ApiError('VALIDATION', `A meet runs for at most ${MAX_DAYS} days.`, 400, 'endsOn');
      }
      await tx.sportsTournament.update({ where: { id }, data: { endsOn, dayStartMin, dayEndMin, restMin: dto.restMin ?? t.restMin, version: { increment: 1 } } });
      return this.refitIn(tx, schoolId, id);
    });
  }

  /** A court, a table or a pool the school found after the draft was made. Every event that belongs on it gains it. */
  addVenue(schoolId: string, id: string, dto: AddVenueDto): Promise<TournamentDetail> {
    return withTenant(schoolId, async (tx) => {
      const t = await this.requireTournament(tx, schoolId, id);
      if (t.status === 'DONE') throw new ApiError('TOURNAMENT_STATE', 'This tournament is finished.', 409);
      const name = dto.name.trim();
      const existing = await tx.sportsVenue.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, tournamentId: id }, select: { id: true, name: true } });
      if (existing.some((v) => v.name.toLowerCase() === name.toLowerCase())) throw new ApiError('VALIDATION', `There is already a venue called "${name}".`, 400, 'name');
      const venue = await tx.sportsVenue.create({ data: { schoolId, tournamentId: id, name, order: existing.length }, select: { id: true } });
      const added = [{ id: venue.id, name, type: inferVenueType(name) }];
      const events = await tx.sportsEvent.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, tournamentId: id }, select: { id: true, sportKey: true, sportName: true, venueIds: true } });
      for (const ev of events) {
        const sport = resolveSport(ev.sportKey, ev.sportName);
        if (!sport) continue;
        const match = venuesForSport(sport, added);
        // A new venue joins the events it belongs to by name or by type. It
        // also rescues an event with NOWHERE to play: a school adds the hall
        // precisely because chess has no board, and a fallback that binds only
        // when nothing else does leaves that event exactly as it was.
        const belongs = match.how === 'named' || match.how === 'type' || (match.how === 'fallback' && ev.venueIds.length === 0);
        if (belongs) {
          await tx.sportsEvent.update({ where: { id: ev.id }, data: { venueIds: [...new Set([...ev.venueIds, venue.id])] } });
        }
      }
      return this.refitIn(tx, schoolId, id);
    });
  }

  /** A venue nothing depends on may go; what stood on it is re-laid on the rest. */
  removeVenue(schoolId: string, id: string, venueId: string): Promise<TournamentDetail> {
    return withTenant(schoolId, async (tx) => {
      const t = await this.requireTournament(tx, schoolId, id);
      if (t.status !== 'DRAFT') throw new ApiError('TOURNAMENT_STATE', 'A venue can only be removed while the tournament is a draft.', 409);
      const v = await tx.sportsVenue.findFirst({ where: { id: venueId, schoolId, tournamentId: id }, select: { id: true } });
      if (!v) throw new ApiError('VALIDATION', 'That venue is not in this tournament.', 400, 'venueId');
      const [count, events] = await Promise.all([
        tx.sportsVenue.count({ where: { schoolId, tournamentId: id } }),
        tx.sportsEvent.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, tournamentId: id }, select: { id: true, sportName: true, venueIds: true } }),
      ]);
      if (count <= 1) throw new ApiError('VALIDATION', 'A meet needs at least one venue.', 400, 'venueId');
      const orphan = events.find((e) => e.venueIds.length === 1 && e.venueIds[0] === venueId);
      if (orphan) throw new ApiError('VALIDATION', `${orphan.sportName} has nowhere else to play. Give it another venue first.`, 400, 'venueId');
      for (const e of events) if (e.venueIds.includes(venueId)) await tx.sportsEvent.update({ where: { id: e.id }, data: { venueIds: e.venueIds.filter((x) => x !== venueId) } });
      await tx.sportsMatch.updateMany({ where: { schoolId, event: { tournamentId: id }, venueId }, data: { venueId: null, atMin: null } });
      await tx.sportsHeat.updateMany({ where: { schoolId, event: { tournamentId: id }, venueId }, data: { venueId: null, atMin: null } });
      await tx.sportsVenue.delete({ where: { id: venueId } });
      return this.refitIn(tx, schoolId, id);
    });
  }

  /** Hold an event to one day of the meet, or let it fall wherever it fits. */
  pinEvent(schoolId: string, id: string, eventId: string, dto: PinEventDto): Promise<TournamentDetail> {
    return withTenant(schoolId, async (tx) => {
      const t = await this.requireTournament(tx, schoolId, id);
      if (t.status === 'DONE') throw new ApiError('TOURNAMENT_STATE', 'This tournament is finished.', 409);
      const r = await tx.sportsEvent.updateMany({ where: { id: eventId, schoolId, tournamentId: id }, data: { dayIdx: dto.dayIdx } });
      if (r.count === 0) throw new ApiError('EVENT_NOT_FOUND', 'That event is not in this tournament.', 404);
      return this.refitIn(tx, schoolId, id);
    });
  }

  /**
   * Lay the plan out again on the days and venues the meet has NOW — after a
   * day, a venue, the hours or a pin changed. Anything already played keeps
   * its slot and its place in every child's diary; only unplayed slots move.
   */
  refit(schoolId: string, id: string): Promise<TournamentDetail> {
    return withTenant(schoolId, async (tx) => {
      const t = await this.requireTournament(tx, schoolId, id);
      if (t.status === 'DONE') throw new ApiError('TOURNAMENT_STATE', 'This tournament is finished.', 409);
      return this.refitIn(tx, schoolId, id);
    });
  }

  private async refitIn(tx: TenantTx, schoolId: string, id: string): Promise<TournamentDetail> {
    const t = await this.requireTournament(tx, schoolId, id);
    if (t.status === 'DONE') throw new ApiError('TOURNAMENT_STATE', 'This tournament is finished.', 409);
    const days = Math.round((t.endsOn.getTime() - t.startsOn.getTime()) / 86_400_000) + 1;
    const w: DayWindow = { dayStartMin: t.dayStartMin, dayEndMin: t.dayEndMin, days };
    const [venues, events] = await Promise.all([
      tx.sportsVenue.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, tournamentId: id }, orderBy: { order: 'asc' }, select: { id: true } }),
      tx.sportsEvent.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, tournamentId: id }, orderBy: { order: 'asc' } }),
    ]);
    const all = venues.map((v) => v.id);
    if (!all.length) throw new ApiError('NEED_VENUE', 'The meet has no venue to schedule on.', 400);
    const eventIds = events.map((e) => e.id);
    const [matches, heats, entries] = eventIds.length
      ? await Promise.all([
        tx.sportsMatch.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, eventId: { in: eventIds } }, orderBy: [{ roundIdx: 'asc' }, { pos: 'asc' }] }),
        tx.sportsHeat.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, eventId: { in: eventIds } }, orderBy: [{ kind: 'desc' }, { idx: 'asc' }], include: { marks: { select: { studentId: true, lane: true }, orderBy: { lane: 'asc' } } } }),
        tx.sportsEntry.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId, eventId: { in: eventIds } }, select: { eventId: true, studentId: true, std: true, section: true, student: { select: { houseId: true } } } }),
      ])
      : [[], [], []];
    const slotOf = (eventId: string) => events.find((e) => e.id === eventId)?.slotMin ?? 30;
    const playedMatch = (m: { winner: string | null; scoreA: number[] }) => !!m.winner || m.scoreA.length > 0;
    const cursor = cursorFrom(
      [
        ...matches.filter(playedMatch).map((m) => ({ venueId: m.venueId, atMin: m.atMin, slotMin: slotOf(m.eventId) })),
        ...heats.filter((h) => h.done).map((h) => ({ venueId: h.venueId, atMin: h.atMin, slotMin: slotOf(h.eventId) })),
      ],
      all,
      w,
    );
    const diary = newDiary(t.restMin);
    for (const h of heats) {
      if (!h.done || h.atMin == null) continue;
      for (const k of h.marks) diary.free.set(k.studentId, Math.max(diary.free.get(k.studentId) ?? 0, h.atMin + slotOf(h.eventId)));
    }
    for (const ev of events) {
      const venueIds = ev.venueIds.filter((v) => all.includes(v));
      if (!venueIds.length) continue;
      const sport = resolveSport(ev.sportKey, ev.sportName);
      const mine = entries.filter((e) => e.eventId === ev.id).map((e) => ({ studentId: e.studentId, std: e.std, section: e.section, houseId: e.student.houseId }));
      const pin = ev.dayIdx != null ? dayFloor(Math.min(ev.dayIdx, days - 1), w) : 0;
      const open = matches.filter((m) => m.eventId === ev.id && !m.bye && !playedMatch(m));
      if (open.length && sport) {
        const plans: MatchPlan[] = open.map((m) => ({ stage: m.stage as 'CLASS' | 'FINAL', groupLabel: m.groupLabel, roundIdx: m.roundIdx, roundName: m.roundName, pos: m.pos, aSide: m.aSide, bSide: m.bSide, bye: false, winner: null, venueId: null, atMin: null }));
        scheduleMatches(plans, venueIds, ev.slotMin, cursor, w, diary, (side) => peopleOfSide(side, sport, mine, ev.teamBasis as TeamBasis), pin);
        for (const [i, p] of plans.entries()) await tx.sportsMatch.update({ where: { id: open[i].id }, data: { venueId: p.venueId, atMin: p.atMin } });
      }
      const openHeats = heats.filter((h) => h.eventId === ev.id && !h.done);
      if (openHeats.length) {
        const plans: HeatPlan[] = openHeats.map((h) => ({ kind: h.kind as HeatKind, groupLabel: h.groupLabel, idx: h.idx, venueId: null, atMin: null, lanes: h.marks.map((k) => ({ lane: k.lane, side: `s:${k.studentId}` })) }));
        scheduleHeats(plans, venueIds, ev.slotMin, cursor, w, diary, pin);
        for (const [i, p] of plans.entries()) await tx.sportsHeat.update({ where: { id: openHeats[i].id }, data: { venueId: p.venueId, atMin: p.atMin } });
      }
    }
    await tx.sportsTournament.update({ where: { id }, data: { version: { increment: 1 } } });
    return this.getIn(tx, schoolId, id);
  }

  /** Put late-built slots after everything already on the event's venues. */
  private async scheduleLate(tx: TenantTx, schoolId: string, tournamentId: string, venueIds: string[], slotMin: number, matches: MatchPlan[], heats: HeatPlan[], dayIdx?: number | null): Promise<void> {
    const t = await tx.sportsTournament.findUnique({ where: { id: tournamentId }, select: { dayStartMin: true, dayEndMin: true, startsOn: true, endsOn: true } });
    if (!t || venueIds.length === 0) throw new ApiError('NEED_VENUE', 'This event has no venue to schedule on.', 400);
    const w: DayWindow = { dayStartMin: t.dayStartMin, dayEndMin: t.dayEndMin, days: Math.round((t.endsOn.getTime() - t.startsOn.getTime()) / 86_400_000) + 1 };
    const [bm, bh] = await Promise.all([
      tx.sportsMatch.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, event: { tournamentId }, venueId: { in: venueIds }, atMin: { not: null } }, select: { venueId: true, atMin: true, event: { select: { slotMin: true } } } }),
      tx.sportsHeat.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, event: { tournamentId }, venueId: { in: venueIds }, atMin: { not: null } }, select: { venueId: true, atMin: true, event: { select: { slotMin: true } } } }),
    ]);
    const cursor = cursorFrom([...bm, ...bh].map((b) => ({ venueId: b.venueId, atMin: b.atMin, slotMin: b.event.slotMin })), venueIds, w);
    const pin = dayIdx != null ? dayFloor(Math.min(dayIdx, w.days - 1), w) : 0;
    if (matches.length) scheduleMatches(matches, venueIds, slotMin, cursor, w, undefined, undefined, pin);
    if (heats.length) scheduleHeats(heats, venueIds, slotMin, cursor, w, undefined, pin);
  }

  private async requireTournament(tx: TenantTx, schoolId: string, id: string) {
    const t = await tx.sportsTournament.findFirst({ where: { id, schoolId } });
    if (!t) throw new ApiError('TOURNAMENT_NOT_FOUND', 'That tournament is not in this school.', 404);
    return t;
  }
}

function matchData(schoolId: string, eventId: string, m: MatchPlan): Prisma.SportsMatchCreateManyInput {
  return { schoolId, eventId, stage: m.stage, groupLabel: m.groupLabel, roundIdx: m.roundIdx, roundName: m.roundName, pos: m.pos, aSide: m.aSide, bSide: m.bSide, bye: m.bye, winner: m.winner, venueId: m.venueId, atMin: m.atMin };
}

function studentOf(side: string): string {
  const p = parseSide(side);
  if (p?.kind !== 'student') throw new ApiError('VALIDATION', 'A heat lane must hold a student, not a section.', 400);
  return p.studentId;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Tue 15 Sep" for day `idx` of a meet that starts on `startsOn` (a DATE column, UTC midnight). Fixed arrays, not Intl: the same on every runtime. */
export function dayLabel(startsOn: Date, idx: number): string {
  const d = new Date(startsOn.getTime() + idx * 86_400_000);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
