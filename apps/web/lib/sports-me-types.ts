/**
 * The `/me/sports` payload — the child's own sports tab, and the teacher's
 * view of the published meets (mirrors
 * apps/api/src/modules/sports/internal/sports-me.service.ts). Pure types.
 */
import type { Scoring } from '@skoolos/types';

export interface MeSportsMatch {
  id: string; stage: string; groupLabel: string; roundName: string; aSide: string | null; bSide: string | null; scoreA: number[]; scoreB: number[];
  winner: string | null; bye: boolean; walkover: boolean; venue: string | null; atMin: number | null;
}
export interface MeSportsHeat { id: string; kind: 'HEAT' | 'FINAL'; idx: number; venue: string | null; atMin: number | null; done: boolean; lane: number; mark: number | null; rank: number | null }
export interface MeSportsEvent {
  eventId: string; tournamentId: string; sportName: string; kind: 'MATCH' | 'MEASURED' | 'JUDGED'; scoring: Scoring; groupLabel: string; category: string; structure: string; side: string;
  matches: MeSportsMatch[]; heats: MeSportsHeat[];
}
export interface MeSportsTournament { id: string; name: string; startsOn: string; endsOn: string; status: 'DRAFT' | 'LIVE' | 'DONE'; dayStartMin: number; events: MeSportsEvent[]; sideNames: Record<string, string> }
export interface MeSportsRecord { id: string; sportName: string; groupKey: string; category: string; text: string; holderName: string; sinceYear: number; untilYear: number | null; status: string }
export interface MeSportsAttempt { id: string; sportName: string; groupKey: string; category: string; text: string; status: string; source: string; createdAt: string }

export type MeSportsPayload =
  | { role: 'STUDENT'; house: { id: string; name: string; color: string } | null; tournaments: MeSportsTournament[]; records: { records: MeSportsRecord[]; attempts: MeSportsAttempt[] } }
  | { role: 'TEACHER'; tournaments: { id: string; name: string; startsOn: string; endsOn: string; status: string }[]; houses: { id: string; name: string; color: string; points: number; members: number }[] };
