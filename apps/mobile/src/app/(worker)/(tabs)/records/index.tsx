import { useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { AGE_GROUPS, SPORTS, type Band } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { useDeskMe } from '@/lib/use-desk';
import { can, type AttemptView, type RecordView, type RosterStudent } from '@/lib/sports-desk';
import { formatDate } from '@/lib/portal';
import { Empty, ErrorState, Page, PageHeader, Screen, SectionTitle, Toast } from '@/components/ui';
import { Button, Eyebrow, NumberBox, Row, SearchBox } from '@/components/desk';
import { Sheet } from '@/components/Sheet';
import { SegmentedField } from '@/components/Field';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

interface Settings { grouping: 'BANDS' | 'AGE'; bands: Band[] }

/**
 * THE BOOK OF RECORDS, from the desk side. What is WAITING first — attempts
 * a teacher logged at practice that need a second pair of eyes (VERIFY) —
 * then the standing records by sport. "Log an attempt" (ENTER) is the one
 * thing a sports teacher does on the field with a phone in hand: a child
 * just threw further than the book says, write it down before it is lost.
 */
export default function Records() {
  const tokens = useTokens();
  const me = useDeskMe();
  const verify = can(me.data, 'VERIFY');
  const enter = can(me.data, 'ENTER');
  const book = useQuery<{ records: RecordView[]; pending: number }>('/sports/records');
  const attempts = useQuery<AttemptView[]>(verify ? '/sports/records/attempts' : null);
  const [logging, setLogging] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const bySport = useMemo(() => {
    const map = new Map<string, RecordView[]>();
    for (const r of book.data?.records ?? []) map.set(r.sportName, [...(map.get(r.sportName) ?? []), r]);
    return [...map.entries()];
  }, [book.data]);

  function reloadAll() { book.reload(); attempts.reload(); }

  function decide(a: AttemptView, approve: boolean) {
    const go = async (note?: string) => {
      setDeciding(a.id);
      try {
        await api.request(`/sports/records/attempts/${a.id}/decide`, { method: 'POST', body: { approve, ...(note ? { note } : {}) } });
        setToast({ kind: 'success', message: approve ? `${a.student.name} — record approved.` : 'Attempt rejected.' });
        reloadAll();
      } catch (e) {
        setToast({ kind: 'error', message: e instanceof ApiError ? e.message : 'Could not decide that attempt.' });
      } finally { setDeciding(null); }
    };
    if (approve) {
      Alert.alert('Approve as a school record?', `${a.student.name} · ${a.sportName} ${a.groupKey} ${a.category} · ${a.text}`, [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Approve', onPress: () => void go() },
      ]);
    } else {
      Alert.alert('Reject this attempt?', 'It stays in the log as rejected. The child is not told.', [
        { text: 'Keep', style: 'cancel' },
        { text: 'Reject', style: 'destructive', onPress: () => void go('Rejected at the desk') },
      ]);
    }
  }

  return (
    <Screen onRefresh={() => { book.refresh(); attempts.refresh(); }} refreshing={book.refreshing}>
      <SectionTitle title="Records" actionLabel={enter ? 'Log attempt' : undefined} onAction={enter ? () => setLogging(true) : undefined} />
      {book.loading && <LoadingRows label="Opening the book…" rows={3} />}
      {book.error && !book.data && <ErrorState error={book.error} onRetry={book.reload} />}

      {verify && (
        <Page testID="records-pending">
          <PageHeader title="Waiting for you" icon="requests" actionLabel={attempts.data?.length ? String(attempts.data.length) : undefined} />
          {attempts.loading && !attempts.data && <LoadingRows label="Fetching attempts…" rows={2} />}
          {attempts.error && !attempts.data && <ErrorState error={attempts.error} onRetry={attempts.reload} />}
          {attempts.data && attempts.data.length === 0 && <Empty>Nothing to verify. A logged attempt shows up here.</Empty>}
          {(attempts.data ?? []).map((a, i) => (
            <View key={a.id} testID={`attempt-${a.id}`} style={{ paddingVertical: 10, paddingHorizontal: 12, gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: tokens.color.line }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontWeight: '700', color: tokens.color.ink, fontSize: 14 }}>{a.student.name}{a.student.classLabel ? ` · ${a.student.classLabel}` : ''}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 1 }}>{a.sportName} · {a.groupKey} {a.category} · {a.source === 'TRIAL' ? 'trial' : 'practice'}{a.witnessed ? ' · witnessed' : ''} · {formatDate(a.createdAt)}</Text>
                </View>
                <Text style={{ fontFamily: font.mono, fontWeight: '700', fontSize: 15, color: tokens.color.ink }}>{a.text}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><Button small variant="danger" testID={`reject-${a.id}`} label="Reject" onPress={() => decide(a, false)} busy={deciding === a.id} /></View>
                <View style={{ flex: 1 }}><Button small testID={`approve-${a.id}`} label="Approve" onPress={() => decide(a, true)} busy={deciding === a.id} /></View>
              </View>
            </View>
          ))}
        </Page>
      )}

      {book.data && bySport.length === 0 && <Page><Empty icon="results">No school records yet. The first approved attempt opens the book.</Empty></Page>}
      {bySport.map(([sport, rows]) => (
        <View key={sport} style={{ gap: 6 }}>
          <Eyebrow>{sport}</Eyebrow>
          <Page>
            {rows.map((r, i) => (
              <Row key={r.id} first={i === 0} testID={`record-${r.id}`} title={`${r.groupKey} ${r.category}`} sub={`${r.holderName} · since ${r.sinceYear}`} right={<Text style={{ fontFamily: font.mono, fontWeight: '700', color: tokens.color.ink }}>{r.text}</Text>} />
            ))}
          </Page>
        </View>
      ))}

      {toast && <Toast kind={toast.kind} message={toast.message} />}
      {logging && <LogAttemptSheet onClose={() => setLogging(false)} onSaved={(m) => { setLogging(false); setToast({ kind: 'success', message: m }); reloadAll(); }} />}
    </Screen>
  );
}

const MARK_SPORTS = SPORTS.filter((s) => s.scoring.type === 'MARK');

function LogAttemptSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (msg: string) => void }) {
  const tokens = useTokens();
  const settings = useQuery<Settings>('/sports/settings');
  const roster = useQuery<RosterStudent[]>('/sports/roster');
  const groups: { id: string; label: string }[] = settings.data?.grouping === 'AGE' ? AGE_GROUPS.map((g) => ({ id: g.id, label: g.label })) : (settings.data?.bands ?? []).map((b) => ({ id: b.id, label: b.label }));

  const [sportQ, setSportQ] = useState('');
  const [sportKey, setSportKey] = useState<string | null>(null);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [category, setCategory] = useState<'Boys' | 'Girls' | 'Mixed'>('Boys');
  const [studentQ, setStudentQ] = useState('');
  const [student, setStudent] = useState<RosterStudent | null>(null);
  const [value, setValue] = useState('');
  const [source, setSource] = useState<'PRACTICE' | 'TRIAL'>('PRACTICE');
  const [witnessed, setWitnessed] = useState<'YES' | 'NO'>('NO');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sport = MARK_SPORTS.find((s) => s.key === sportKey) ?? null;
  const sportHits = sportQ.trim().length ? MARK_SPORTS.filter((s) => s.name.toLowerCase().includes(sportQ.trim().toLowerCase())).slice(0, 6) : [];
  const studentHits = studentQ.trim().length >= 2 ? (roster.data ?? []).filter((s) => s.name.toLowerCase().includes(studentQ.trim().toLowerCase())).slice(0, 6) : [];
  const n = Number(value);
  const ready = !!sport && !!groupKey && !!student && value.trim() !== '' && Number.isFinite(n) && n >= 0;

  async function save() {
    if (!sport || !groupKey || !student) return;
    setBusy(true); setError(null);
    try {
      const r = await api.request<{ beatsStanding: boolean }>('/sports/records/attempts', { method: 'POST', body: { sportKey: sport.key, groupKey, category, studentId: student.id, value: n, source, witnessed: witnessed === 'YES' } });
      onSaved(r.beatsStanding ? `Logged — it beats the standing record. Waiting for verification.` : 'Logged. It does not beat the standing record.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not log the attempt.');
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Log an attempt" subtitle="A mark from practice or a trial. Someone with the verify right approves it." testID="log-attempt-sheet"
      footer={<Button testID="attempt-save" label="Log it" onPress={() => void save()} disabled={!ready} busy={busy} />}>
      <View style={{ gap: 10 }}>
        {sport ? (
          <Row first title={sport.name} sub={`in ${sport.scoring.type === 'MARK' ? sport.scoring.unit : ''}`} right={<Button small variant="ghost" label="Change" onPress={() => { setSportKey(null); setSportQ(''); }} />} />
        ) : (
          <>
            <SearchBox testID="attempt-sport" value={sportQ} onChangeText={setSportQ} placeholder="Sport — 100 m, long jump, shot put…" autoFocus />
            {sportHits.map((s, i) => <Row key={s.key} first={i === 0} testID={`sport-${s.key}`} title={s.name} sub={s.group} onPress={() => { setSportKey(s.key); setSportQ(''); }} />)}
          </>
        )}
        {groups.length > 0 && (
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: tokens.color.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>Group</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {groups.map((g) => <Button key={g.id} small variant={groupKey === g.id ? 'primary' : 'ghost'} testID={`group-${g.id}`} label={g.label} onPress={() => setGroupKey(g.id)} />)}
            </View>
          </View>
        )}
        <SegmentedField label="Category" testID="attempt-category" value={category} onChange={setCategory} options={[{ value: 'Boys', label: 'Boys' }, { value: 'Girls', label: 'Girls' }, { value: 'Mixed', label: 'Mixed' }]} />
        {student ? (
          <Row first title={student.name} sub={`Class ${student.std}${student.section}`} right={<Button small variant="ghost" label="Change" onPress={() => { setStudent(null); setStudentQ(''); }} />} />
        ) : (
          <>
            <SearchBox testID="attempt-student" value={studentQ} onChangeText={setStudentQ} placeholder="Child's name" />
            {studentHits.map((s, i) => <Row key={s.id} first={i === 0} testID={`student-${s.id}`} title={s.name} sub={`Class ${s.std}${s.section}`} onPress={() => { setStudent(s); setStudentQ(''); }} />)}
          </>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ flex: 1, fontSize: 13, color: tokens.color.ink, fontWeight: '600' }}>Mark{sport?.scoring.type === 'MARK' ? ` (${sport.scoring.unit})` : ''}</Text>
          <NumberBox decimal width={110} testID="attempt-value" value={value} onChangeText={(v) => setValue(v.replace(/[^0-9.]/g, ''))} placeholder="0.00" />
        </View>
        <SegmentedField label="Where" testID="attempt-source" value={source} onChange={setSource} options={[{ value: 'PRACTICE', label: 'Practice' }, { value: 'TRIAL', label: 'Trial' }]} />
        <SegmentedField label="Another teacher saw it" testID="attempt-witnessed" value={witnessed} onChange={setWitnessed} options={[{ value: 'YES', label: 'Yes' }, { value: 'NO', label: 'No' }]} />
        {error && <Toast kind="error" message={error} />}
      </View>
    </Sheet>
  );
}
