import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { cycleStatus, type HallStatus, type HallToday } from '@/lib/library-desk';
import { Empty, ErrorState, Figure, Page, PageHeader, Pill, Screen, SectionTitle, Toast } from '@/components/ui';
import { Button, Row } from '@/components/desk';
import { Sheet } from '@/components/Sheet';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

const WORD: Record<HallStatus, string> = { PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late' };
const TONE: Record<HallStatus, 'green' | 'red' | 'amber'> = { PRESENT: 'green', ABSENT: 'red', LATE: 'amber' };

/**
 * THE READING HALL — which class is in right now (from the timetable), and
 * the roll for the class the librarian picks. Marks start from the
 * teacher's register for the day, so the usual visit is "everyone came,
 * save"; a tap on a row cycles Present → Absent → Late. Saved as the
 * library's own visit, never over the class register.
 */
export default function Hall() {
  const tokens = useTokens();
  const [sectionId, setSectionId] = useState<string | null>(null);
  const hall = useQuery<HallToday>(`/library/hall${sectionId ? `?classSectionId=${sectionId}` : ''}`);
  const [marks, setMarks] = useState<Record<string, HallStatus>>({});
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const d = hall.data;

  // Pick the class that is in the hall right now the first time we know it.
  useEffect(() => {
    if (!sectionId && d?.hall.nowClasses[0]) setSectionId(d.hall.nowClasses[0].id);
  }, [d, sectionId]);
  useEffect(() => {
    if (d?.section) setMarks(Object.fromEntries(d.roster.map((r) => [r.studentId, r.status])));
  }, [d]);

  const counts = useMemo(() => {
    const c = { PRESENT: 0, ABSENT: 0, LATE: 0 };
    for (const v of Object.values(marks)) c[v] += 1;
    return c;
  }, [marks]);

  async function save() {
    if (!d?.section) return;
    setBusy(true);
    try {
      await api.request('/library/hall/visits', { method: 'POST', body: { classSectionId: d.section.id, date: d.date, ...(d.period ? { periodId: d.period.id } : {}), source: 'RETAKEN', marks: d.roster.map((r) => ({ studentId: r.studentId, status: marks[r.studentId] ?? r.status })) } });
      setToast({ kind: 'success', message: `${d.section.className} visit saved.` });
      hall.reload();
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof ApiError ? e.message : 'Could not save the visit.' });
    } finally { setBusy(false); }
  }

  return (
    <Screen onRefresh={hall.refresh} refreshing={hall.refreshing}>
      <SectionTitle title="Reading hall" actionLabel="Pick class" onAction={() => setPicking(true)} />
      {hall.loading && !d && <LoadingRows label="Looking at the hall…" rows={3} />}
      {hall.error && !d && <ErrorState error={hall.error} onRetry={hall.reload} />}
      {d && (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Figure testID="hall-inuse" label="In the hall" value={`${d.hall.inUse} of ${d.hall.capacityClasses}`} hint={d.hall.nowClasses.map((c) => c.className).join(', ') || (d.period ? `${d.period.label} · no class booked` : 'no period now')} tone={d.hall.inUse > d.hall.capacityClasses ? 'bad' : undefined} />
            {d.section && <Figure testID="hall-counts" label={d.section.className} value={`${counts.PRESENT}/${d.roster.length}`} hint={`${counts.ABSENT} absent · ${counts.LATE} late`} />}
          </View>

          {!d.section ? (
            <Page><Empty icon="take">No class picked. Tap “Pick class” to take the roll for a visit.</Empty></Page>
          ) : (
            <Page testID="hall-roll">
              <PageHeader title="Roll" icon="take" actionLabel={d.savedVisit ? 'Saved today' : d.teacherRegister?.taken ? `From ${d.teacherRegister.takenBy ?? 'the register'}` : undefined} />
              {d.roster.length === 0 && <Empty>No children on this class roll.</Empty>}
              {d.roster.map((r, i) => {
                const s = marks[r.studentId] ?? r.status;
                return (
                  <Pressable key={r.studentId} testID={`roll-${r.studentId}`} accessibilityRole="button" accessibilityLabel={`${r.name}, ${WORD[s]}. Tap to change.`} onPress={() => setMarks({ ...marks, [r.studentId]: cycleStatus(s) })}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, minHeight: 48, borderTopWidth: i ? 1 : 0, borderTopColor: tokens.color.line, backgroundColor: pressed ? tokens.color.indigo50 : 'transparent' })}>
                    <Text style={{ width: 28, fontFamily: font.mono, fontSize: 12, color: tokens.color.sub }}>{r.rollNo ?? '·'}</Text>
                    <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: '600', color: tokens.color.ink }}>{r.name}</Text>
                    <Pill tone={TONE[s]}>{WORD[s]}</Pill>
                  </Pressable>
                );
              })}
            </Page>
          )}
          {d.section && d.roster.length > 0 && <Button testID="hall-save" label="Save visit" onPress={() => void save()} busy={busy} />}
        </>
      )}
      {toast && <Toast kind={toast.kind} message={toast.message} />}
      <Sheet open={picking} onClose={() => setPicking(false)} title="Which class is in?" testID="hall-pick">
        {(d?.sections ?? []).map((s, i) => (
          <Row key={s.id} first={i === 0} testID={`pick-${s.id}`} title={s.className} sub={d?.hall.nowClasses.some((c) => c.id === s.id) ? 'in the hall now' : undefined} onPress={() => { setSectionId(s.id); setPicking(false); }} />
        ))}
      </Sheet>
    </Screen>
  );
}
