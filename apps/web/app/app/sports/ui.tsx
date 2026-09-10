'use client';
/**
 * Shared pieces of the sports desk — payload types mirroring `/sports/*`,
 * the desk's permission hook, small formatters. The visual atoms come from the
 * library's `ui.tsx` (Card, StatCard, Pill …) so the two wings read as one
 * product; nothing here draws a pixel of its own.
 */
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import type { Band, Scoring, SportsPerm } from '@skoolos/types';

export { Card, CardBody, CardHead, EmptyRow, ListRow, Pill, StatCard, apiErrorCode, useDebounced } from '@/app/app/library/ui';

// ── payloads (mirror apps/api/src/modules/sports) ──
export interface DeskMe { perms: SportsPerm[]; isAdmin: boolean }
export interface SettingsView { grouping: 'BANDS' | 'AGE'; bands: Band[]; pointsPlacing: number[]; pointsMatchWin: number; pointsClassWin: number; publishNeedsAdmin: boolean }
export interface HouseRow { id: string; name: string; color: string; order: number; members: number; points: number }
export interface PointRow { id: string; houseId: string; points: number; reason: string; eventId: string | null; createdAt: string }
export interface RosterStudent { id: string; name: string; std: number; section: string; gender: string | null; dob: string | null; houseId: string | null }
export interface TournamentRow { id: string; name: string; startsOn: string; endsOn: string; status: 'DRAFT' | 'LIVE' | 'DONE'; published: boolean; version: number; events: number }
export interface MatchRow {
  id: string; stage: string; groupLabel: string; roundIdx: number; roundName: string; pos: number; aSide: string | null; bSide: string | null;
  scoreA: number[]; scoreB: number[]; winner: string | null; bye: boolean; walkover: boolean; venueId: string | null; atMin: number | null; version: number; savedAt: string | null;
}
export interface HeatRow { id: string; kind: 'HEAT' | 'FINAL'; idx: number; venueId: string | null; atMin: number | null; done: boolean; marks: { studentId: string; side: string; lane: number; mark: number | null; rank: number | null }[] }
export interface EventDetail {
  id: string; sportKey: string; sportName: string; kind: 'MATCH' | 'MEASURED' | 'JUDGED'; scoring: Scoring; teamSize: number; groupKey: string; groupLabel: string; category: string;
  structure: string; slotMin: number; lanes: number; venueIds: string[]; order: number;
  entries: { studentId: string; side: string; std: number; section: string; houseId: string | null }[];
  matches: MatchRow[]; heats: HeatRow[];
}
export interface TournamentDetail {
  id: string; name: string; startsOn: string; endsOn: string; grouping: 'BANDS' | 'AGE'; dayStartMin: number; dayEndMin: number; status: 'DRAFT' | 'LIVE' | 'DONE'; published: boolean; version: number;
  venues: { id: string; name: string; order: number }[]; events: EventDetail[]; sideNames: Record<string, string>; bands: Band[];
}
export interface RecordView {
  id: string; sportKey: string; sportName: string; groupKey: string; category: string; value: number; unit: string; text: string;
  holderName: string; holderStudentId: string | null; setOn: string | null; sinceYear: number; untilYear: number | null; status: 'STANDING' | 'BROKEN' | 'VOID'; source: string; note: string | null;
}
export interface AttemptView {
  id: string; sportKey: string; sportName: string; groupKey: string; category: string; value: number; unit: string; text: string; source: string; witnessed: boolean; createdAt: string;
  student: { id: string; name: string; classLabel: string };
}
export interface CoachRow { id: string; name: string; email: string | null; isActive: boolean; hasLogin: boolean; perms: SportsPerm[]; stored: boolean }

/** What this desk may do. Cached per host; the API decides, the UI only hides. */
export function useDesk() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const me = useQuery({ queryKey: ['sports-me', host], enabled: !!host, staleTime: 60_000, queryFn: () => api.get<DeskMe>('/sports/me') });
  const perms = me.data?.perms ?? [];
  return { api, host, isAdmin: me.data?.isAdmin ?? false, perms, can: (p: SportsPerm) => perms.includes(p), ready: !!me.data };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-09-15' → 'Tue 15 Sep' (fixed arrays, never Intl — the same string on every machine). */
export function fmtDay(iso: string, withWeekday = true): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const core = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return withWeekday ? `${DAYS[d.getUTCDay()]} ${core}` : core;
}

/** Day `idx` of a meet that starts on `startsOn`. */
export function dayOfMeet(startsOn: string, idx: number): string {
  const d = new Date(new Date(`${startsOn}T00:00:00Z`).getTime() + idx * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export const TONE: Record<string, 'good' | 'amber' | 'bad' | 'brand' | 'muted'> = { DRAFT: 'muted', LIVE: 'good', DONE: 'brand' };
export const STATUS_LABEL: Record<string, string> = { DRAFT: 'Draft', LIVE: 'Live', DONE: 'Finished' };

/** The two words the desk uses for a category filter on the roster. */
export function genderBucket(g: string | null): 'Boys' | 'Girls' | null {
  if (!g) return null;
  if (/^(m|male|boy)/i.test(g)) return 'Boys';
  if (/^(f|female|girl)/i.test(g)) return 'Girls';
  return null;
}
