import { Injectable } from '@nestjs/common';
import { Prisma, withTenant, type TenantTx } from '@skoolos/db';
import {
  assertNotificationKind, assertNotificationOutboxKind, drawPlacings, formatMark, judgeScores, nextSlot, parseSide, rankMarks, resolveSport,
  type DrawMatch, type Sport,
} from '@skoolos/types';
import { ApiError } from '../../../common/errors/api-error';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { SportsHousesService } from './sports-houses.service';
import { diffAwards, ordinal, placingAwards, winAward, type Award } from './sports-points';
import { SportsRecordsService } from './sports-records.service';
import { SportsSettingsService } from './sports-settings.service';
import { SportsTournamentsService } from './sports-tournaments.service';
import type { MarksDto, ScoreDto } from './sports.dto';

type MatchLike = { id: string; stage: string; groupLabel: string; roundIdx: number; roundName: string; pos: number; aSide: string | null; bSide: string | null; winner: string | null; bye: boolean; scoreA: number[]; scoreB: number[] };

/**
 * The results desk (spec §5). Two rules make it safe for two sports teachers
 * on two phones:
 *
 *  1. Every save carries the `version` it loaded; the UPDATE is conditional
 *     on it, so the second desk gets MATCH_CHANGED and reloads — never a
 *     silent overwrite, never a duplicate advance.
 *  2. House points are a ledger: a re-scored match writes the difference, so
 *     the table is always the sum of its rows.
 *
 * A winner moves into the next slot at once; the last class final builds the
 * band final; the last heat builds the final heat; a mark that beats the book
 * queues a record attempt. All inside the one transaction of the save.
 */
@Injectable()
export class SportsResultsService {
  constructor(
    private readonly tournaments: SportsTournamentsService,
    private readonly houses: SportsHousesService,
    private readonly settings: SportsSettingsService,
    private readonly records: SportsRecordsService,
  ) {}

  score(schoolId: string, actorId: string, matchId: string, dto: ScoreDto): Promise<{ version: number; winner: string | null; complete: boolean; finalBuilt: boolean }> {
    assertNotificationKind('SPORTS');
    assertNotificationOutboxKind('SPORTS_NOTICE');
    return withTenant(schoolId, async (tx) => {
      const m = await tx.sportsMatch.findFirst({
        where: { id: matchId, schoolId },
        include: { event: { select: { id: true, tournamentId: true, sportKey: true, sportName: true, groupKey: true, category: true, structure: true, tournament: { select: { status: true, name: true } } } } },
      });
      if (!m) throw new ApiError('MATCH_NOT_FOUND', 'That match is not in this school.', 404);
      if (m.event.tournament.status !== 'LIVE') throw new ApiError('TOURNAMENT_STATE', m.event.tournament.status === 'DRAFT' ? 'Publish the tournament before entering results.' : 'This tournament is finished.', 409);
      if (m.bye) throw new ApiError('MATCH_LOCKED', 'A bye has no score.', 409);
      if (!m.aSide || !m.bSide) throw new ApiError('VALIDATION', 'Both sides must be known before a score can be entered.', 400);
      if (m.version !== dto.version) throw new ApiError('MATCH_CHANGED', 'Someone else saved this match first. Reload and enter it again.', 409);
      const sport = resolveSport(m.event.sportKey, m.event.sportName);
      if (!sport) throw new ApiError('UNKNOWN_SPORT', 'This event\'s sport is no longer in the catalogue.', 400);

      let winner: string | null = null;
      let complete = false;
      let scoreA = dto.scoreA;
      let scoreB = dto.scoreB;
      if (dto.walkover) {
        winner = dto.walkover === 'A' ? m.aSide : m.bSide;
        complete = true;
        scoreA = [];
        scoreB = [];
      } else {
        const j = judgeScores(sport.scoring, dto.scoreA, dto.scoreB);
        if (j.error === 'BAD_SCORE' || j.error === 'EXTRA_GAME' || j.error === 'NOT_A_MATCH') throw new ApiError('BAD_SCORE', badScoreMessage(j.error, sport), 400, 'scoreA');
        winner = j.winner ? (j.winner === 'A' ? m.aSide : m.bSide) : null;
        complete = j.complete;
      }
      const prevWinner = m.winner;
      const next = await tx.sportsMatch.findFirst({ where: { schoolId, eventId: m.eventId, stage: m.stage, groupLabel: m.groupLabel, roundIdx: m.roundIdx + 1, pos: nextSlot(m.roundIdx, m.pos).pos } });
      if (next && prevWinner && winner !== prevWinner && (next.winner || next.scoreA.length)) {
        throw new ApiError('MATCH_LOCKED', 'The winner has already played the next round. Clear that result first.', 409);
      }
      const saved = await tx.sportsMatch.updateMany({
        where: { id: matchId, version: dto.version },
        data: { scoreA, scoreB, winner, walkover: !!dto.walkover, version: { increment: 1 }, savedById: actorId, savedAt: new Date() },
      });
      if (saved.count === 0) throw new ApiError('MATCH_CHANGED', 'Someone else saved this match first. Reload and enter it again.', 409);
      if (next) {
        const side = nextSlot(m.roundIdx, m.pos).side === 'a' ? 'aSide' : 'bSide';
        if (next[side] !== winner) await tx.sportsMatch.update({ where: { id: next.id }, data: { [side]: winner } });
      }

      // ── house points (ledger) ──
      const settings = this.settings.view(await this.settings.ensure(tx, schoolId));
      const houseOf = await this.houseLookup(tx, schoolId, [m.aSide, m.bSide]);
      const line = `${sport.name} ${m.groupLabel}`;
      const awards: Award[] = [];
      awards.push(...diffAwards(winAward(prevWinner, houseOf, settings.pointsMatchWin, `${line} ${m.roundName}: win`), winAward(winner, houseOf, settings.pointsMatchWin, `${line} ${m.roundName}: win`)));
      let finalBuilt = false;
      if (m.stage === 'FINAL') {
        // Placings move with every result in the final stage: a semi-final loss is joint third the moment it is saved.
        {
          const stage = await tx.sportsMatch.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, eventId: m.eventId, stage: 'FINAL' }, select: { id: true, stage: true, groupLabel: true, roundIdx: true, roundName: true, pos: true, aSide: true, bSide: true, winner: true, bye: true, scoreA: true, scoreB: true } });
          const withOld = toRounds(stage.map((x) => (x.id === matchId ? { ...x, winner: prevWinner } : x)));
          const withNew = toRounds(stage.map((x) => (x.id === matchId ? { ...x, winner } : x)));
          const sides = [...new Set(stage.flatMap((x) => [x.aSide, x.bSide]).filter((s): s is string => !!s))];
          const houseOfAll = await this.houseLookup(tx, schoolId, sides);
          const reason = `${sport.name} ${m.event.category}`;
          awards.push(...diffAwards(placingAwards(drawPlacings(withOld), houseOfAll, settings.pointsPlacing, reason), placingAwards(drawPlacings(withNew), houseOfAll, settings.pointsPlacing, reason)));
        }
      } else if (!next) {
        awards.push(...diffAwards(winAward(prevWinner, houseOf, settings.pointsClassWin, `${line}: champion`), winAward(winner, houseOf, settings.pointsClassWin, `${line}: champion`)));
        if (winner) finalBuilt = await this.tournaments.ensureFinal(tx, schoolId, m.eventId);
      }
      if (awards.length) await this.houses.awardMany(tx, schoolId, awards.map((a) => ({ ...a, eventId: m.eventId })));

      // ── tell the players ──
      if (complete && winner && winner !== prevWinner) {
        const people = await this.peopleOf(tx, schoolId, m.eventId, [m.aSide, m.bSide]);
        const nameOf = (side: string | null) => (side ? people.names.get(side) ?? side : '—');
        const line2 = dto.walkover ? `${nameOf(winner)} through on a walkover.` : `${nameOf(m.aSide)} ${scoreline(scoreA, scoreB)} ${nameOf(m.bSide)}. ${nameOf(winner)} ${next ? 'goes through' : m.stage === 'CLASS' ? 'is class champion' : 'wins the final'}.`;
        const title = `${sport.name} ${m.groupLabel}: ${m.roundName}`;
        const rows: Prisma.NotificationCreateManyInput[] = [];
        const pushes: Prisma.NotificationOutboxCreateManyInput[] = [];
        for (const userId of people.userIds) {
          rows.push({ schoolId, userId, kind: 'SPORTS', title, body: line2, linkType: 'sports', linkId: m.event.tournamentId });
          pushes.push({ schoolId, kind: 'SPORTS_NOTICE', targetUserId: userId, payload: { title, body: line2, tournamentId: m.event.tournamentId } as unknown as Prisma.InputJsonValue });
        }
        if (rows.length) {
          await tx.notification.createMany({ data: rows });
          await tx.notificationOutbox.createMany({ data: pushes });
        }
      }
      await tx.sportsTournament.update({ where: { id: m.event.tournamentId }, data: { version: { increment: 1 } } });
      return { version: dto.version + 1, winner, complete, finalBuilt };
    });
  }

  /** Save a heat sheet. `done` ranks it, queues record attempts, awards final placings and may build the final. */
  marks(schoolId: string, actorId: string, heatId: string, dto: MarksDto): Promise<{ finalBuilt: boolean; attempts: number }> {
    assertNotificationKind('SPORTS');
    assertNotificationOutboxKind('SPORTS_NOTICE');
    return withTenant(schoolId, async (tx) => {
      const h = await tx.sportsHeat.findFirst({
        where: { id: heatId, schoolId },
        include: { marks: { orderBy: { lane: 'asc' } }, event: { select: { id: true, tournamentId: true, sportKey: true, sportName: true, groupKey: true, category: true, lanes: true, tournament: { select: { status: true } } } } },
      });
      if (!h) throw new ApiError('HEAT_NOT_FOUND', 'That heat is not in this school.', 404);
      if (h.event.tournament.status !== 'LIVE') throw new ApiError('TOURNAMENT_STATE', h.event.tournament.status === 'DRAFT' ? 'Publish the tournament before entering marks.' : 'This tournament is finished.', 409);
      const sport = resolveSport(h.event.sportKey, h.event.sportName);
      if (!sport || sport.scoring.type !== 'MARK') throw new ApiError('UNKNOWN_SPORT', 'This event has no measured mark.', 400);
      const scoring = sport.scoring;
      const inHeat = new Map(h.marks.map((k) => [k.studentId, k]));
      for (const x of dto.marks) {
        if (!inHeat.has(x.studentId)) throw new ApiError('VALIDATION', 'A mark was sent for someone not in this heat.', 400, 'marks');
        if (x.mark != null && !(Number.isFinite(x.mark) && x.mark >= 0)) throw new ApiError('BAD_SCORE', 'A mark must be a number of zero or more, or empty for no mark.', 400, 'marks');
      }
      const typed = new Map(dto.marks.map((x) => [x.studentId, x.mark == null ? null : Number(x.mark.toFixed(scoring.precision))]));
      const merged = h.marks.map((k) => ({ studentId: k.studentId, lane: k.lane, mark: typed.has(k.studentId) ? typed.get(k.studentId)! : k.mark }));
      const ranked = dto.done ? new Map(rankMarks(merged.map((k) => ({ item: k.studentId, mark: k.mark })), scoring.lowerIsBetter).map((r) => [r.item, r.rank])) : null;
      const rows = merged.map((k) => ({ schoolId, heatId, studentId: k.studentId, lane: k.lane, mark: k.mark, rank: ranked ? ranked.get(k.studentId) ?? null : null }));
      await tx.sportsMark.deleteMany({ where: { heatId } });
      await tx.sportsMark.createMany({ data: rows });
      await tx.sportsHeat.update({ where: { id: heatId }, data: { done: dto.done } });

      const settings = this.settings.view(await this.settings.ensure(tx, schoolId));
      const studentIds = merged.map((k) => k.studentId);
      const students = await tx.student.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, id: { in: studentIds } }, select: { id: true, firstName: true, lastName: true, houseId: true, userId: true } });
      const byId = new Map(students.map((s) => [s.id, s]));
      const houseOf = (side: string) => byId.get(side.slice(2))?.houseId ?? null;
      if (h.kind === 'FINAL') {
        const reason = `${sport.name} ${h.event.category}`;
        const before = h.done ? placingAwards(h.marks.map((k) => ({ side: `s:${k.studentId}`, rank: k.rank })), houseOf, settings.pointsPlacing, reason) : [];
        const after = dto.done ? placingAwards(rows.map((k) => ({ side: `s:${k.studentId}`, rank: k.rank })), houseOf, settings.pointsPlacing, reason) : [];
        const delta = diffAwards(before, after);
        if (delta.length) await this.houses.awardMany(tx, schoolId, delta.map((a) => ({ ...a, eventId: h.event.id })));
      }
      let attempts = 0;
      let finalBuilt = false;
      if (dto.done) {
        const line = { sportKey: h.event.sportKey, sportName: h.event.sportName, groupKey: h.event.groupKey, category: h.event.category, scoring };
        for (const k of rows) {
          if (k.mark == null) continue;
          if (await this.records.noteAttemptIfRecord(tx, schoolId, actorId, line, k.studentId, k.mark, 'MEET')) attempts++;
        }
        const label = h.kind === 'FINAL' ? 'Final' : `Heat ${h.idx + 1}`;
        const notes: Prisma.NotificationCreateManyInput[] = [];
        const pushes: Prisma.NotificationOutboxCreateManyInput[] = [];
        for (const k of rows) {
          const s = byId.get(k.studentId);
          if (!s?.userId) continue;
          const title = `${sport.name} ${h.event.category}: ${label}`;
          const body = k.mark == null ? 'No mark recorded.' : `${formatMark(scoring, k.mark)}${k.rank ? ` · ${ordinal(k.rank)}${h.kind === 'FINAL' && k.rank === 1 ? ' — champion!' : ''}` : ''}`;
          notes.push({ schoolId, userId: s.userId, kind: 'SPORTS', title, body, linkType: 'sports', linkId: h.event.tournamentId });
          pushes.push({ schoolId, kind: 'SPORTS_NOTICE', targetUserId: s.userId, payload: { title, body, tournamentId: h.event.tournamentId } as unknown as Prisma.InputJsonValue });
        }
        if (notes.length) {
          await tx.notification.createMany({ data: notes });
          await tx.notificationOutbox.createMany({ data: pushes });
        }
        if (h.kind === 'HEAT') finalBuilt = await this.tournaments.ensureHeatFinal(tx, schoolId, h.event.id);
      }
      await tx.sportsTournament.update({ where: { id: h.event.tournamentId }, data: { version: { increment: 1 } } });
      return { finalBuilt, attempts };
    });
  }

  /** side → houseId for the students among the sides (sections have no house). */
  private async houseLookup(tx: TenantTx, schoolId: string, sides: (string | null)[]): Promise<(side: string) => string | null> {
    const ids = sides.map((s) => (s ? parseSide(s) : null)).flatMap((p) => (p?.kind === 'student' ? [p.studentId] : []));
    if (!ids.length && !sides.some((s) => s?.startsWith('h:'))) return () => null;
    const rows = ids.length ? await tx.student.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, id: { in: ids } }, select: { id: true, houseId: true } }) : [];
    const byId = new Map(rows.map((r) => [r.id, r.houseId]));
    return (side: string) => {
      const p = parseSide(side);
      if (p?.kind === 'house') return p.houseId; // a house team's points go to the house itself
      return p?.kind === 'student' ? byId.get(p.studentId) ?? null : null;
    };
  }

  /** The logins behind two sides — the two students, or every entered child of the two sections — and a name per side. */
  private async peopleOf(tx: TenantTx, schoolId: string, eventId: string, sides: (string | null)[]): Promise<{ userIds: string[]; names: Map<string, string> }> {
    const [entries, houses] = await Promise.all([
      tx.sportsEntry.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId, eventId }, select: { studentId: true, std: true, section: true, student: { select: { firstName: true, lastName: true, userId: true, houseId: true } } } }),
      sides.some((s) => s?.startsWith('h:')) ? tx.house.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId }, select: { id: true, name: true } }) : Promise.resolve([] as { id: string; name: string }[]),
    ]);
    const userIds = new Set<string>();
    const names = new Map<string, string>();
    for (const side of sides) {
      const p = side ? parseSide(side) : null;
      if (!p) continue;
      if (p.kind === 'student') {
        const e = entries.find((x) => x.studentId === p.studentId);
        if (e) {
          names.set(side!, `${e.student.firstName} ${e.student.lastName}`.trim());
          if (e.student.userId) userIds.add(e.student.userId);
        }
      } else if (p.kind === 'section') {
        names.set(side!, `${p.std} ${p.section}`);
        for (const e of entries) if (e.std === p.std && e.section.trim().toUpperCase() === p.section && e.student.userId) userIds.add(e.student.userId);
      } else if (p.kind === 'class') {
        names.set(side!, `Class ${p.std}`);
        for (const e of entries) if (e.std === p.std && e.student.userId) userIds.add(e.student.userId);
      } else {
        names.set(side!, houses.find((h) => h.id === p.houseId)?.name ?? 'House');
        for (const e of entries) if (e.student.houseId === p.houseId && e.student.userId) userIds.add(e.student.userId);
      }
    }
    return { userIds: [...userIds], names };
  }
}

function toRounds(matches: MatchLike[]): DrawMatch[][] {
  const total = Math.max(...matches.map((m) => m.roundIdx)) + 1;
  const rounds: DrawMatch[][] = Array.from({ length: total }, () => []);
  for (const m of matches) rounds[m.roundIdx].push({ round: m.roundIdx, pos: m.pos, a: m.aSide, b: m.bSide, bye: m.bye, winner: m.winner });
  for (const r of rounds) r.sort((x, y) => x.pos - y.pos);
  return rounds;
}

function scoreline(a: number[], b: number[]): string {
  return a.length ? a.map((x, i) => `${x}-${b[i]}`).join(' ') : 'v';
}

function badScoreMessage(error: string, sport: Sport): string {
  const s = sport.scoring;
  if (error === 'EXTRA_GAME') return `The match was already decided — best of ${s.type === 'GAMES' ? s.bestOf : 1}.`;
  if (s.type === 'GAMES') return `Each ${s.label.toLowerCase().replace(/s$/, '')} goes to ${s.to}, win by ${s.winBy}${s.cap ? `, capped at ${s.cap}` : ''}; only the last one listed may be in progress.`;
  if (s.type === 'SINGLE') return `${s.label} for each side, and the decider (${s.decider.toLowerCase()}) only when the first numbers are level.`;
  return 'That is not a legal score for this sport.';
}
