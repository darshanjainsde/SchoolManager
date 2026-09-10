import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { groupLabel, resolveSport, sideOfSection, sideOfStudent, sidesAreSections, type Scoring } from '@skoolos/types';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { SportsHousesService } from './sports-houses.service';
import { SportsRecordsService } from './sports-records.service';
import { SportsSettingsService } from './sports-settings.service';

export interface MyEvent {
  eventId: string; tournamentId: string; sportName: string; kind: string; scoring: Scoring; groupLabel: string; category: string; structure: string; side: string;
  matches: { id: string; stage: string; groupLabel: string; roundName: string; aSide: string | null; bSide: string | null; scoreA: number[]; scoreB: number[]; winner: string | null; bye: boolean; walkover: boolean; venue: string | null; atMin: number | null }[];
  heats: { id: string; kind: string; idx: number; venue: string | null; atMin: number | null; done: boolean; lane: number; mark: number | null; rank: number | null }[];
}
export interface MyTournament { id: string; name: string; startsOn: string; endsOn: string; status: string; dayStartMin: number; events: MyEvent[]; sideNames: Record<string, string> }

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The portal tab: what is next for me, how I did, the records I hold, my house. Teachers get the published meets and the house table. */
@Injectable()
export class SportsMeService {
  constructor(private readonly settings: SportsSettingsService, private readonly houses: SportsHousesService, private readonly records: SportsRecordsService) {}

  async forUser(schoolId: string, userId: string, role: string) {
    if (role !== 'STUDENT') {
      const [tournaments, houses] = await Promise.all([this.published(schoolId), this.houses.list(schoolId)]);
      return { role: 'TEACHER' as const, tournaments, houses };
    }
    return withTenant(schoolId, async (tx) => {
      const me = await tx.student.findFirst({ where: { schoolId, userId }, select: { id: true, houseId: true } });
      if (!me) return { role: 'STUDENT' as const, house: null, tournaments: [] as MyTournament[], records: { records: [], attempts: [] } };
      const settings = this.settings.view(await this.settings.ensure(tx, schoolId));
      const entries = await tx.sportsEntry.findMany({
        take: LIST_CEILING.ACTIVITY, where: { schoolId, studentId: me.id, event: { tournament: { published: true } } },
        select: { eventId: true, std: true, section: true, event: { select: { id: true, sportKey: true, sportName: true, kind: true, groupKey: true, category: true, structure: true, tournamentId: true, tournament: { select: { id: true, name: true, startsOn: true, endsOn: true, status: true, dayStartMin: true } } } } },
      });
      const eventIds = entries.map((e) => e.eventId);
      const tournamentIds = [...new Set(entries.map((e) => e.event.tournamentId))];
      const sides = entries.map((e) => {
        const sport = resolveSport(e.event.sportKey, e.event.sportName);
        return sport && sidesAreSections(sport) ? sideOfSection(e.std, e.section) : sideOfStudent(me.id);
      });
      const [matches, marks, venues, others, house] = await Promise.all([
        eventIds.length ? tx.sportsMatch.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, eventId: { in: eventIds }, OR: [{ aSide: { in: sides } }, { bSide: { in: sides } }] }, orderBy: [{ roundIdx: 'asc' }, { pos: 'asc' }] }) : [],
        eventIds.length ? tx.sportsMark.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId, studentId: me.id, heat: { eventId: { in: eventIds } } }, select: { lane: true, mark: true, rank: true, heat: { select: { id: true, eventId: true, kind: true, idx: true, venueId: true, atMin: true, done: true } } } }) : [],
        tournamentIds.length ? tx.sportsVenue.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, tournamentId: { in: tournamentIds } }, select: { id: true, name: true } }) : [],
        eventIds.length ? tx.sportsEntry.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId, eventId: { in: eventIds } }, select: { studentId: true, std: true, section: true, student: { select: { firstName: true, lastName: true } } } }) : [],
        me.houseId ? tx.house.findFirst({ where: { id: me.houseId, schoolId }, select: { id: true, name: true, color: true } }) : null,
      ]);
      const venueName = new Map(venues.map((v) => [v.id, v.name]));
      const sideNames: Record<string, string> = {};
      for (const o of others) {
        sideNames[sideOfStudent(o.studentId)] = `${o.student.firstName} ${o.student.lastName}`.trim();
        sideNames[sideOfSection(o.std, o.section)] = `${o.std} ${o.section}`;
      }
      const byTournament = new Map<string, MyTournament>();
      entries.forEach((e, i) => {
        const t = e.event.tournament;
        const sport = resolveSport(e.event.sportKey, e.event.sportName);
        const row = byTournament.get(t.id) ?? { id: t.id, name: t.name, startsOn: iso(t.startsOn), endsOn: iso(t.endsOn), status: t.status, dayStartMin: t.dayStartMin, events: [], sideNames };
        row.events.push({
          eventId: e.eventId, tournamentId: t.id, sportName: e.event.sportName, kind: e.event.kind, scoring: sport?.scoring ?? { type: 'SINGLE', label: 'Points', decider: 'Decider' },
          groupLabel: groupLabel(settings.grouping, settings.bands, e.event.groupKey), category: e.event.category, structure: e.event.structure, side: sides[i],
          matches: matches.filter((m) => m.eventId === e.eventId && (m.aSide === sides[i] || m.bSide === sides[i])).map((m) => ({
            id: m.id, stage: m.stage, groupLabel: m.groupLabel, roundName: m.roundName, aSide: m.aSide, bSide: m.bSide, scoreA: m.scoreA, scoreB: m.scoreB, winner: m.winner, bye: m.bye, walkover: m.walkover,
            venue: m.venueId ? venueName.get(m.venueId) ?? null : null, atMin: m.atMin,
          })),
          heats: marks.filter((k) => k.heat.eventId === e.eventId).map((k) => ({ id: k.heat.id, kind: k.heat.kind, idx: k.heat.idx, venue: k.heat.venueId ? venueName.get(k.heat.venueId) ?? null : null, atMin: k.heat.atMin, done: k.heat.done, lane: k.lane, mark: k.mark, rank: k.rank })),
        });
        byTournament.set(t.id, row);
      });
      const records = await this.records.mine(schoolId, me.id);
      return { role: 'STUDENT' as const, house, tournaments: [...byTournament.values()].sort((a, b) => b.startsOn.localeCompare(a.startsOn)), records };
    });
  }

  private published(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.sportsTournament.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, published: true }, orderBy: { startsOn: 'desc' }, select: { id: true, name: true, startsOn: true, endsOn: true, status: true } });
      return rows.map((t) => ({ id: t.id, name: t.name, startsOn: iso(t.startsOn), endsOn: iso(t.endsOn), status: t.status }));
    });
  }
}
