import { useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { useDeskMe } from '@/lib/use-desk';
import { bySport, can, groupLine, markText, nextSlot, openWork, scoreline, sideName, when, type EventDetail, type HeatRow, type MatchRow, type RosterStudent, type TournamentDetail } from '@/lib/sports-desk';
import { Empty, ErrorState, Page, PageHeader, Pill, Screen, SectionTitle, Toast } from '@/components/ui';
import { Button, Eyebrow, NumberBox, Row } from '@/components/desk';
import { Sheet } from '@/components/Sheet';
import { SegmentedField } from '@/components/Field';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/**
 * ONE MEET, ON THE DAY. Events grouped by the noun the teacher says out loud
 * — "the 100 m", then "Senior Girls" under it — never a flat list of 70 heats
 * in start-time order. A match row carries its score or an Enter button; a
 * heat row its state or a Marks button. Both open a sheet that saves with
 * the version it loaded, so two phones on one meet cannot overwrite each
 * other silently: the loser gets "Someone else saved this first" and a
 * reload, which is the server's rule (MATCH_CHANGED), not the app's.
 */
export default function Meet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tokens = useTokens();
  const me = useDeskMe();
  const q = useQuery<TournamentDetail>(id ? `/sports/tournaments/${id}` : null);
  const roster = useQuery<RosterStudent[]>('/sports/roster');
  const names = useMemo(() => new Map((roster.data ?? []).map((s) => [s.id, s.name])), [roster.data]);
  const t = q.data;
  const groups = useMemo(() => (t ? bySport(t.events) : []), [t]);
  const work = t ? openWork(t) : null;
  const next = t ? nextSlot(t) : null;
  const venueName = (vid: string | null) => t?.venues.find((v) => v.id === vid)?.name ?? null;

  const [scoring, setScoring] = useState<{ e: EventDetail; m: MatchRow } | null>(null);
  const [marking, setMarking] = useState<{ e: EventDetail; h: HeatRow } | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [publishing, setPublishing] = useState(false);

  const enter = can(me.data, 'ENTER');
  const publish = can(me.data, 'PUBLISH');

  function confirmPublish() {
    if (!t) return;
    Alert.alert('Publish this meet?', 'Every child in it sees their fixtures and results in the app.', [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Publish', onPress: () => void doPublish() },
    ]);
  }
  async function doPublish() {
    if (!t) return;
    setPublishing(true);
    try {
      await api.request(`/sports/tournaments/${t.id}/publish`, { method: 'POST', body: {} });
      setToast({ kind: 'success', message: 'Published.' });
      q.reload();
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof ApiError ? e.message : 'Could not publish.' });
    } finally { setPublishing(false); }
  }

  return (
    <Screen onRefresh={() => { q.refresh(); roster.refresh(); }} refreshing={q.refreshing}>
      <SectionTitle title={t?.name ?? 'Meet'} />
      {q.loading && <LoadingRows label="Opening the meet…" rows={4} />}
      {q.error && !t && <ErrorState error={q.error} onRetry={q.reload} />}
      {t && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 4, flexWrap: 'wrap' }}>
            <Pill tone={t.status === 'LIVE' ? 'green' : t.status === 'DONE' ? 'neutral' : 'amber'}>{t.status === 'LIVE' ? 'Live' : t.status === 'DONE' ? 'Done' : 'Draft'}</Pill>
            <Pill tone={t.published ? 'green' : 'amber'}>{t.published ? 'Published' : 'Not published'}</Pill>
            {work && (work.matches + work.heats > 0) && <Text testID="meet-open-work" style={{ fontSize: 12, color: tokens.color.sub }}>{work.matches} match{work.matches === 1 ? '' : 'es'} · {work.heats} heat{work.heats === 1 ? '' : 's'} to enter</Text>}
          </View>

          {next && (
            <Page testID="meet-next">
              <PageHeader title="Next up" icon="timetable" />
              <Row first title={next.label} sub={`${next.event.sportName} · ${groupLine(next.event)} · ${when(t.startsOn, next.atMin)}`} />
            </Page>
          )}

          {!t.published && publish && (
            <Button testID="meet-publish" variant="amber" label="Publish to students" onPress={confirmPublish} busy={publishing} />
          )}

          {groups.length === 0 && <Page><Empty icon="sports">No events in this meet yet. Add them on the web desk.</Empty></Page>}

          {groups.map((g) => (
            <View key={g.sport} style={{ gap: 6 }}>
              <Eyebrow>{g.sport}</Eyebrow>
              {g.events.map((e) => (
                <Page key={e.id} testID={`event-${e.id}`}>
                  <PageHeader title={groupLine(e)} actionLabel={e.dayIdx != null ? `Day ${e.dayIdx + 1}` : undefined} />
                  {e.matches.length === 0 && e.heats.length === 0 && <Empty>Nothing scheduled yet.</Empty>}
                  {e.matches.map((m, i) => {
                    const line = scoreline(m);
                    const playable = !m.bye && !!m.aSide && !!m.bSide;
                    return (
                      <Row
                        key={m.id}
                        first={i === 0}
                        testID={`match-${m.id}`}
                        title={`${sideName(t, m.aSide)} v ${sideName(t, m.bSide)}`}
                        sub={`${m.roundName}${venueName(m.venueId) ? ` · ${venueName(m.venueId)}` : ''} · ${when(t.startsOn, m.atMin)}`}
                        right={
                          m.winner || m.bye ? (
                            <View style={{ alignItems: 'flex-end' }}>
                              {line ? <Text numberOfLines={1} style={{ fontFamily: font.mono, fontSize: 12.5, color: tokens.color.ink, fontWeight: '700' }}>{line}</Text> : null}
                              <Text style={{ fontSize: 11, color: tokens.color.green }}>{m.bye ? 'Bye' : `${sideName(t, m.winner)} won`}</Text>
                            </View>
                          ) : enter && playable ? (
                            <Button small variant="ghost" testID={`enter-${m.id}`} label="Enter" onPress={() => setScoring({ e, m })} />
                          ) : (
                            <Pill tone="neutral">{playable ? 'Not played' : 'Waiting'}</Pill>
                          )
                        }
                      />
                    );
                  })}
                  {e.heats.map((h, i) => (
                    <Row
                      key={h.id}
                      first={e.matches.length === 0 && i === 0}
                      testID={`heat-${h.id}`}
                      title={`${h.kind === 'FINAL' ? 'Final' : `Heat ${h.idx + 1}`}${h.groupLabel ? ` · ${h.groupLabel}` : ''}`}
                      sub={`${h.marks.length} in lanes${venueName(h.venueId) ? ` · ${venueName(h.venueId)}` : ''} · ${when(t.startsOn, h.atMin)}`}
                      right={
                        h.done ? <Pill tone="green">Done</Pill>
                        : enter ? <Button small variant="ghost" testID={`marks-${h.id}`} label={h.marks.some((x) => x.mark != null) ? 'Continue' : 'Marks'} onPress={() => setMarking({ e, h })} />
                        : <Pill tone="neutral">Open</Pill>
                      }
                    />
                  ))}
                </Page>
              ))}
            </View>
          ))}
        </>
      )}

      {toast && <Toast kind={toast.kind} message={toast.message} />}

      {scoring && t && (
        <ScoreSheet t={t} e={scoring.e} m={scoring.m} onClose={() => setScoring(null)} onSaved={(msg) => { setScoring(null); setToast({ kind: 'success', message: msg }); q.reload(); }} />
      )}
      {marking && t && (
        <MarksSheet e={marking.e} h={marking.h} names={names} onClose={() => setMarking(null)} onSaved={(msg) => { setMarking(null); setToast({ kind: 'success', message: msg }); q.reload(); }} />
      )}
    </Screen>
  );
}

// ── Score entry ──────────────────────────────────────────────────────────────
function ScoreSheet({ t, e, m, onClose, onSaved }: { t: TournamentDetail; e: EventDetail; m: MatchRow; onClose: () => void; onSaved: (msg: string) => void }) {
  const tokens = useTokens();
  const maxSets = e.scoring.type === 'GAMES' ? e.scoring.bestOf : 1;
  const init = Math.max(1, m.scoreA.length);
  const [a, setA] = useState<string[]>(Array.from({ length: init }, (_, i) => (m.scoreA[i] != null ? String(m.scoreA[i]) : '')));
  const [b, setB] = useState<string[]>(Array.from({ length: init }, (_, i) => (m.scoreB[i] != null ? String(m.scoreB[i]) : '')));
  const [walkover, setWalkover] = useState<'NONE' | 'A' | 'B'>('NONE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scoreA = a.map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n));
  const scoreB = b.map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n));
  const complete = walkover !== 'NONE' || (scoreA.length === a.length && scoreB.length === b.length && a.length > 0);

  async function save() {
    setBusy(true); setError(null);
    try {
      const body = walkover === 'NONE' ? { scoreA, scoreB, version: m.version } : { scoreA: [], scoreB: [], version: m.version, walkover };
      const r = await api.request<{ winner: string | null }>(`/sports/matches/${m.id}/score`, { method: 'POST', body });
      onSaved(r.winner ? `${sideName(t, r.winner)} won.` : 'Score saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the score.');
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={`${sideName(t, m.aSide)} v ${sideName(t, m.bSide)}`} subtitle={`${e.sportName} · ${groupLine(e)} · ${m.roundName}`} testID="score-sheet"
      footer={<Button testID="score-save" label="Save score" onPress={() => void save()} disabled={!complete} busy={busy} />}>
      <View style={{ gap: 10 }}>
        {walkover === 'NONE' && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
              <View style={{ width: 80 }} />
              <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', fontWeight: '700', color: tokens.color.ink }}>{sideName(t, m.aSide)}</Text>
              <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', fontWeight: '700', color: tokens.color.ink }}>{sideName(t, m.bSide)}</Text>
            </View>
            {a.map((_, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
                <Text style={{ width: 80, fontSize: 12.5, color: tokens.color.sub }}>{maxSets > 1 ? `Set ${i + 1}` : e.scoring.type === 'SINGLE' ? e.scoring.decider : 'Score'}</Text>
                <View style={{ flex: 1, alignItems: 'center' }}><NumberBox testID={`score-a-${i}`} value={a[i]} onChangeText={(v) => setA(a.map((x, j) => (j === i ? v.replace(/\D/g, '') : x)))} placeholder="0" /></View>
                <View style={{ flex: 1, alignItems: 'center' }}><NumberBox testID={`score-b-${i}`} value={b[i]} onChangeText={(v) => setB(b.map((x, j) => (j === i ? v.replace(/\D/g, '') : x)))} placeholder="0" /></View>
              </View>
            ))}
            {a.length < maxSets && (
              <Button small variant="ghost" testID="score-add-set" label={`Add set ${a.length + 1}`} onPress={() => { setA([...a, '']); setB([...b, '']); }} />
            )}
          </>
        )}
        <SegmentedField label="Walkover" testID="score-walkover" value={walkover} onChange={setWalkover}
          options={[{ value: 'NONE', label: 'Played' }, { value: 'A', label: `${sideName(t, m.aSide)} came` }, { value: 'B', label: `${sideName(t, m.bSide)} came` }]} />
        {error && <Toast kind="error" message={error} />}
      </View>
    </Sheet>
  );
}

// ── Marks entry ──────────────────────────────────────────────────────────────
function MarksSheet({ e, h, names, onClose, onSaved }: { e: EventDetail; h: HeatRow; names: Map<string, string>; onClose: () => void; onSaved: (msg: string) => void }) {
  const tokens = useTokens();
  const lanes = useMemo(() => [...h.marks].sort((x, y) => x.lane - y.lane), [h.marks]);
  const [marks, setMarks] = useState<Record<string, string>>(() => Object.fromEntries(lanes.map((l) => [l.studentId, l.mark == null ? '' : String(l.mark)])));
  const [busy, setBusy] = useState<'save' | 'done' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unit = e.scoring.type === 'MARK' ? e.scoring.unit : '';
  const anyMark = Object.values(marks).some((v) => v.trim() !== '');

  async function save(done: boolean) {
    setBusy(done ? 'done' : 'save'); setError(null);
    try {
      const body = { done, marks: lanes.map((l) => { const v = marks[l.studentId]?.trim(); const n = v ? Number(v) : NaN; return { studentId: l.studentId, mark: Number.isFinite(n) ? n : null }; }) };
      await api.request(`/sports/heats/${h.id}/marks`, { method: 'POST', body });
      onSaved(done ? 'Heat closed and ranked.' : 'Marks saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the marks.');
      setBusy(null);
    }
  }
  function confirmDone() {
    Alert.alert('Close this heat?', 'Marks are ranked, points go to houses, and records are checked. A lane left blank counts as no mark.', [
      { text: 'Keep open', style: 'cancel' },
      { text: 'Close heat', onPress: () => void save(true) },
    ]);
  }

  return (
    <Sheet open onClose={onClose} title={`${h.kind === 'FINAL' ? 'Final' : `Heat ${h.idx + 1}`}${h.groupLabel ? ` · ${h.groupLabel}` : ''}`} subtitle={`${e.sportName} · ${groupLine(e)}${unit ? ` · in ${unit}` : ''}`} testID="marks-sheet"
      footer={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Button testID="marks-save" variant="ghost" label="Save" onPress={() => void save(false)} disabled={!anyMark} busy={busy === 'save'} /></View>
          <View style={{ flex: 1 }}><Button testID="marks-done" label="Close heat" onPress={confirmDone} disabled={!anyMark} busy={busy === 'done'} /></View>
        </View>
      }>
      <View style={{ gap: 6 }}>
        {lanes.map((l, i) => (
          <View key={l.studentId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, borderTopWidth: i ? 1 : 0, borderTopColor: tokens.color.line }}>
            <Text style={{ width: 24, fontFamily: font.mono, color: tokens.color.sub, fontSize: 12 }}>{l.lane}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontWeight: '600', color: tokens.color.ink, fontSize: 14 }}>{names.get(l.studentId) ?? l.side}</Text>
              {l.mark != null && <Text style={{ fontSize: 11, color: tokens.color.sub }}>was {markText(e.scoring, l.mark)}</Text>}
            </View>
            <NumberBox decimal width={92} testID={`mark-${l.studentId}`} value={marks[l.studentId] ?? ''} placeholder={unit || '—'} onChangeText={(v) => setMarks({ ...marks, [l.studentId]: v.replace(/[^0-9.]/g, '') })} />
          </View>
        ))}
        {lanes.length === 0 && <Empty>No one in this heat.</Empty>}
        {error && <Toast kind="error" message={error} />}
      </View>
    </Sheet>
  );
}
