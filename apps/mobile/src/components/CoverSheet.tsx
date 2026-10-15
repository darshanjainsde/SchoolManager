import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { invalidate, useQuery } from '@/lib/query';
import { fmtWeekdayDay } from '@/lib/dates';
import { Sheet } from '@/components/Sheet';
import { Button } from '@/components/desk';
import { Pill, Tick } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/**
 * COVER A LEAVE WITH ONE TEACHER — the app's half of the console drawer.
 *
 * After a pick, the leave desk is asked once whether the same teacher should
 * take the rest of that leave. The sheet lists every open period by day with
 * the teacher's standing in each: free ones ticked, clashes named and left
 * open. Same endpoints as the console (`/manage/leave/:id/cover-preview` and
 * `/cover-batch`), so the phone and the desk can never disagree about who is
 * free, and the server re-checks every tick on save.
 */

export type CoverState = 'FREE' | 'THEIRS' | 'TAKEN' | 'TEACHING' | 'COVERING' | 'ON_LEAVE';
export interface CoverRow { gapId: string; date: string; periodLabel: string; time: string; className: string; state: CoverState; reason: string | null }
export interface CoverPreview {
  leave: { id: string; teacherName: string; dates: string };
  teacher: { id: string; name: string };
  busyDayAt: number;
  days: { date: string; label: string; coversBefore: number }[];
  rows: CoverRow[];
}
interface BatchResult {
  given: number;
  alreadyTheirs: number;
  skipped: { gapId: string; when: string; className: string; why: string; reason: string }[];
  stillOpen: number;
}

const CLASH: ReadonlySet<CoverState> = new Set(['TEACHING', 'COVERING', 'ON_LEAVE']);
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
export const previewPath = (leaveId: string, teacherId: string) => `/manage/leave/${leaveId}/cover-preview?teacherId=${teacherId}`;

/** "Give Rahul the rest of Priya's leave?" — under the gap just picked; silent until it knows there is something to give. */
export function CoverOffer({ leaveId, teacherId, onOpen, onDismiss }: { leaveId: string; teacherId: string; onOpen: () => void; onDismiss: () => void }) {
  const tokens = useTokens();
  const q = useQuery<CoverPreview>(previewPath(leaveId, teacherId));
  const p = q.data;
  if (!p) return null;
  const free = p.rows.filter((r) => r.state === 'FREE').length;
  if (free === 0) return null;
  const clash = p.rows.filter((r) => CLASH.has(r.state)).length;
  const open = p.rows.filter((r) => r.state !== 'THEIRS' && r.state !== 'TAKEN').length;
  return (
    <View testID="cover-offer" accessibilityLiveRegion="polite" style={{ marginHorizontal: 12, marginBottom: 12, padding: 12, gap: 10, borderRadius: tokens.radius.card, backgroundColor: tokens.color.indigo50 }}>
      <View style={{ gap: 3 }}>
        <Text style={{ fontFamily: font.sans, fontSize: 15, lineHeight: 20, fontWeight: '700', color: tokens.color.ink }}>
          Give {p.teacher.name} the rest of {p.leave.teacherName}&apos;s leave?
        </Text>
        <Text style={{ fontFamily: font.sans, fontSize: 13, lineHeight: 18, color: tokens.color.sub }}>
          Free for {free} of the {n(open, 'open period')}.{clash > 0 ? ` ${clash} ${clash === 1 ? 'clashes' : 'clash'} with their own day and ${clash === 1 ? 'stays' : 'stay'} open.` : ''}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button label={`See the ${n(open, 'period')}`} small variant="primary" onPress={onOpen} testID="cover-offer-open" />
        <Button label="No thanks" small variant="ghost" onPress={onDismiss} testID="cover-offer-dismiss" />
      </View>
    </View>
  );
}

/** A 24 dp box that draws its tick — the app has no checkbox glyph, and a 56 dp row carries the touch. */
function TickBox({ checked, disabled }: { checked: boolean; disabled: boolean }) {
  const tokens = useTokens();
  return (
    <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center',
      borderColor: disabled ? tokens.color.line : tokens.color.indigo, backgroundColor: checked ? tokens.color.indigo50 : 'transparent', opacity: disabled && !checked ? 0.6 : 1 }}>
      {checked ? <Tick size={14} /> : null}
    </View>
  );
}

export function CoverSheet({ open, leaveId, teacherId, onClose, onDone }: { open: boolean; leaveId: string; teacherId: string; onClose: () => void; onDone: () => void }) {
  const tokens = useTokens();
  const q = useQuery<CoverPreview>(open ? previewPath(leaveId, teacherId) : null);
  const p = q.data;
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);

  const free = useMemo(() => (p ? p.rows.filter((r) => r.state === 'FREE') : []), [p]);
  const ticked = free.filter((r) => !unticked.has(r.gapId));
  const byDay = useMemo(() => {
    const m = new Map<string, CoverRow[]>();
    for (const r of p?.rows ?? []) if (r.state !== 'TAKEN') m.set(r.date, [...(m.get(r.date) ?? []), r]);
    return [...m];
  }, [p]);
  const taken = p ? p.rows.filter((r) => r.state === 'TAKEN') : [];
  const theirs = p ? p.rows.filter((r) => r.state === 'THEIRS').length : 0;
  const name = p?.teacher.name ?? 'this teacher';
  const stayOpen = p ? p.rows.filter((r) => r.state !== 'THEIRS' && r.state !== 'TAKEN').length - ticked.length : 0;

  const toggle = (ids: string[], on: boolean) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      for (const id of ids) (on ? next.delete(id) : next.add(id));
      return next;
    });

  async function save() {
    if (saving || ticked.length === 0) return;
    setSaving(true); setError(null);
    try {
      const r = await api.request<BatchResult>(`/manage/leave/${leaveId}/cover-batch`, { method: 'POST', body: { substituteTeacherId: teacherId, substitutionIds: ticked.map((x) => x.gapId) } });
      setResult(r);
      // Every answer about this leave and who is free just changed.
      invalidate('/manage/leave');
      invalidate('/manage/substitution');
      onDone();
    } catch (e) {
      // The server's sentence as it is ("This leave was withdrawn a moment ago…"); the ticks stay.
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setSaving(false);
    }
  }

  const footer = result ? (
    <Button label="Done" onPress={onClose} testID="cover-sheet-done" />
  ) : p ? (
    <View style={{ gap: 8 }}>
      <Text style={{ fontFamily: font.sans, fontSize: 13, color: tokens.color.sub }}>
        {stayOpen > 0 ? `${n(stayOpen, 'period')} ${stayOpen === 1 ? 'stays' : 'stay'} open — pick someone else for ${stayOpen === 1 ? 'it' : 'those'}.` : 'Nothing left open.'}
      </Text>
      <Button label={saving ? 'Giving…' : `Give ${name} ${n(ticked.length, 'period')}`} onPress={save} disabled={saving || ticked.length === 0} testID="cover-sheet-save" />
    </View>
  ) : null;

  const text = (s: string, style: object = {}) => <Text style={[{ fontFamily: font.sans, fontSize: 13, lineHeight: 18, color: tokens.color.sub }, style]}>{s}</Text>;

  return (
    <Sheet open={open} onClose={onClose} testID="cover-sheet" title={p ? `${name} for ${p.leave.teacherName}'s leave` : 'Cover with one teacher'} subtitle={p?.leave.dates} footer={footer}>
      {result ? (
        <View testID="cover-sheet-result" style={{ gap: 12, paddingBottom: 8 }}>
          <Text style={{ fontFamily: font.sans, fontSize: 15, lineHeight: 22, color: tokens.color.ink }}>
            <Text style={{ fontWeight: '700' }}>{name} now covers {n(theirs + result.given, 'period')} of this leave.</Text> They have been told{result.given > 1 ? ' in one message' : ''}.
          </Text>
          {result.skipped.length > 0 ? (
            <View style={{ gap: 4, padding: 10, borderRadius: tokens.radius.field, backgroundColor: tokens.color.amber50 }}>
              <Text style={{ fontFamily: font.sans, fontSize: 13, fontWeight: '700', color: tokens.color.late }}>
                {n(result.skipped.length, 'period was', 'periods were')} not given, because the picture changed:
              </Text>
              {result.skipped.map((k) => (
                <Text key={k.gapId} style={{ fontFamily: font.sans, fontSize: 13, lineHeight: 18, color: tokens.color.ink }}>
                  {k.when ? `${k.when}, ${k.className}: ` : ''}{k.reason}
                </Text>
              ))}
            </View>
          ) : null}
          {text(result.stillOpen > 0 ? `${n(result.stillOpen, 'period')} of this leave still ${result.stillOpen === 1 ? 'needs' : 'need'} a teacher.` : 'Every period of this leave now has a teacher.')}
        </View>
      ) : q.error && !p ? (
        <View style={{ gap: 8, paddingBottom: 8 }}>
          {text(q.error.message || 'Could not check their day.', { color: tokens.color.red })}
          <Button label="Try again" small variant="ghost" onPress={q.reload} testID="cover-sheet-retry" />
        </View>
      ) : !p ? (
        text(`Checking ${name}'s day for each period…`)
      ) : (
        <View style={{ gap: 14, paddingBottom: 8 }}>
          {error ? <Text testID="cover-sheet-error" style={{ fontFamily: font.sans, fontSize: 13, color: tokens.color.red }}>{error}</Text> : null}
          <Text accessibilityLabel={`${name}'s covers each day`} style={{ fontFamily: font.sans, fontSize: 12, lineHeight: 18, color: tokens.color.sub, fontVariant: ['tabular-nums'] }}>
            {p.days.map((d) => {
              const add = ticked.filter((r) => r.date === d.date).length;
              return `${fmtWeekdayDay(d.date)}: ${add > 0 ? `${d.coversBefore} → ${d.coversBefore + add}` : d.coversBefore}`;
            }).join('   ·   ')}
          </Text>
          {byDay.map(([date, rows]) => {
            const before = p.days.find((d) => d.date === date)?.coversBefore ?? 0;
            const dayFree = rows.filter((r) => r.state === 'FREE');
            const dayTicked = dayFree.filter((r) => !unticked.has(r.gapId)).length;
            const after = before + dayTicked;
            const allOn = dayFree.length > 0 && dayTicked === dayFree.length;
            return (
              <View key={date} testID={`cover-day-${date}`}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: allOn, disabled: dayFree.length === 0 }}
                  accessibilityLabel={`All free periods on ${fmtWeekdayDay(date)}`}
                  disabled={dayFree.length === 0}
                  onPress={() => toggle(dayFree.map((r) => r.gapId), !allOn)}
                  testID={`cover-day-toggle-${date}`}
                  style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, borderRadius: tokens.radius.field, backgroundColor: tokens.color.surfaceMuted }}
                >
                  <TickBox checked={allOn} disabled={dayFree.length === 0} />
                  <Text style={{ flex: 1, fontFamily: font.sans, fontSize: 14, fontWeight: '700', color: tokens.color.ink }}>{fmtWeekdayDay(date)}</Text>
                  <Text style={{ fontFamily: font.sans, fontSize: 12, color: tokens.color.sub }}>{dayFree.length} of {rows.length} free</Text>
                </Pressable>
                {after >= p.busyDayAt && dayTicked > 0 ? (
                  <Text testID={`cover-busy-${date}`} style={{ marginTop: 6, marginHorizontal: 10, fontFamily: font.sans, fontSize: 12, color: tokens.color.late }}>
                    {name} would have {after} covers that day.
                  </Text>
                ) : null}
                {rows.map((r) => {
                  const isFree = r.state === 'FREE';
                  const own = r.state === 'THEIRS';
                  const on = own || (isFree && !unticked.has(r.gapId));
                  return (
                    <Pressable
                      key={r.gapId}
                      testID={`cover-row-${r.gapId}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on, disabled: !isFree }}
                      accessibilityLabel={`${r.className}, ${r.periodLabel}${r.reason ? `. ${r.reason}` : ''}`}
                      disabled={!isFree}
                      onPress={() => toggle([r.gapId], !on)}
                      style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: tokens.color.line }}
                    >
                      <TickBox checked={on} disabled={!isFree} />
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <Text style={{ fontFamily: font.sans, fontSize: 14, lineHeight: 19, fontWeight: '600', color: tokens.color.ink }}>
                          {r.className} · {r.periodLabel}
                          {r.time ? <Text style={{ fontWeight: '400', color: tokens.color.sub }}> · {r.time}</Text> : null}
                        </Text>
                        {r.reason ? <Text style={{ fontFamily: font.sans, fontSize: 12, lineHeight: 17, color: CLASH.has(r.state) ? tokens.color.red : tokens.color.sub }}>{r.reason}</Text> : null}
                      </View>
                      <Pill tone={isFree ? 'green' : own ? 'neutral' : 'amber'}>{isFree ? 'Free' : own ? 'Theirs' : 'Busy'}</Pill>
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
          {taken.length > 0
            ? text(`${n(taken.length, 'period')} already covered by someone else — left as ${taken.length === 1 ? 'it is' : 'they are'}.`)
            : null}
        </View>
      )}
    </Sheet>
  );
}
