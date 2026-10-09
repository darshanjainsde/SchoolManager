import { useState } from 'react';
import { Text, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { invalidate, useQuery } from '@/lib/query';
import { shiftISO, todayISO } from '@/lib/attendance';
import { Empty, ErrorState, Page, PageHeader, Pill, Screen, SectionTitle } from '@/components/ui';
import { SegmentedField } from '@/components/Field';
import { Button, Eyebrow, Row } from '@/components/desk';
import { LoadingRows } from '@/components/Loading';
import { LeaveRequestCard } from '@/components/LeaveRequestCard';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';
import { fmtDay, fmtSchoolTime, fmtWeekdayDay } from '@/lib/dates';
import { leaveTypeLabel } from '@/lib/labels';

interface LeaveRow {
  id: string;
  teacherName: string;
  personKind?: 'TEACHER' | 'STAFF';
  type: string;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  /** Which half of a half day — null on an application made before halves existed. */
  halfDayPart?: 'AM' | 'PM' | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reason: string | null;
}

interface GapRow {
  id: string;
  date: string;
  classSectionName: string;
  periodLabel: string;
  originalTeacherName: string;
  substituteTeacherId: string | null;
  substituteTeacherName: string | null;
  acknowledgedAt: string | null;
}

/** What `GET /manage/substitution/:id/candidates` returns — freeTeachersFor, ranked. */
interface Candidate {
  id: string;
  name: string;
  teachesSubject: boolean;
  coversThatDay: number;
}

const day = (iso: string) => fmtDay(iso.slice(0, 10));
const weekday = (iso: string) => fmtWeekdayDay(iso.slice(0, 10));

/** "Half day · morning" — an old half day with no half says just "Half day". */
const halfDayLabel = (r: Pick<LeaveRow, 'halfDay' | 'halfDayPart'>) =>
  r.halfDayPart === 'AM' ? 'Half day · morning' : r.halfDayPart === 'PM' ? 'Half day · afternoon' : 'Half day';

const span = (r: Pick<LeaveRow, 'startDate' | 'endDate' | 'halfDay' | 'halfDayPart'>) =>
  r.halfDay ? `${day(r.startDate)} · ${halfDayLabel(r)}`
    : r.startDate.slice(0, 10) === r.endDate.slice(0, 10) ? day(r.startDate)
      : `${day(r.startDate)} – ${day(r.endDate)}`;

/** "8:10 am", in the school's time. */
const seenAt = (iso: string) => fmtSchoolTime(iso);

/** A 409 means another desk moved first: the server's sentence says how, and the screen must look again. */
const isConflict = (e: unknown) => e instanceof ApiError && e.status === 409;

/**
 * LEAVE, WAITING ON SOMEBODY.
 *
 * The one part of the accounts desk that genuinely belongs on a phone: a
 * decision, made in a corridor, that somebody is standing around waiting for.
 * Approving here is what stops the pay run being blocked on a person who is
 * not at their desk — pending leave is deliberately left out of the month, so
 * an undecided application quietly delays payroll.
 */
function Waiting() {
  const tokens = useTokens();
  const q = useQuery<LeaveRow[]>('/manage/leave?status=PENDING');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404)) {
    return <Empty kind="locked" title="Leave decisions need a right">The school admin grants it under Settings → Leave. Ask them, and this list fills in.</Empty>;
  }
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingRows label="leave waiting" />;

  async function decide(id: string, what: 'approve' | 'reject') {
    setBusy(id); setError(null);
    try {
      await api.request(`/manage/leave/${id}/${what}`, { method: 'POST', body: {} });
      // A cached answer is fresh for 30 s; without forgetting it the decided
      // row would sit here inviting a second tap.
      invalidate('/manage/leave');
      q.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
      // Decided on another desk first: the row is no longer waiting.
      if (isConflict(e)) {
        invalidate('/manage/leave');
        q.reload();
      }
    } finally {
      setBusy(null);
    }
  }

  const rows = q.data;
  return (
    <>
      <PageHeader title={rows.length === 0 ? 'Nothing waiting' : `${rows.length} waiting on you`} icon="take" />
      {/* Above the list, not under a row: a 409 takes its row away. */}
      {error ? (
        <Text testID="leavedesk-error" style={{ paddingHorizontal: 12, paddingBottom: 10, fontFamily: font.sans, fontSize: 12, color: tokens.color.red }}>{error}</Text>
      ) : null}
      {rows.length === 0 ? (
        <Empty kind="done" title="No leave requests waiting">
          New requests land here and ring the bell. Anything undecided is left out of the month&apos;s pay, so an
          empty list is what keeps the pay run unblocked.
        </Empty>
      ) : (
        <View style={{ gap: 8, padding: 8 }}>
          {rows.map((r) => (
            <LeaveRequestCard
              key={r.id}
              id={r.id}
              name={r.teacherName}
              role={r.personKind === 'STAFF' ? 'Staff' : 'Teacher'}
              type={r.type}
              startDate={r.startDate}
              endDate={r.endDate}
              halfDay={r.halfDay}
              halfDayPart={r.halfDayPart}
              reason={r.reason}
              busy={busy === r.id}
              onApprove={() => decide(r.id, 'approve')}
              onReject={() => decide(r.id, 'reject')}
            />
          ))}
        </View>
      )}
    </>
  );
}

/**
 * WHO IS FREE FOR ONE GAP — asked when the picker opens, never before.
 *
 * Mounted fresh each time it opens (the parent keys it), so it can never show
 * the last gap's teachers, or a teacher a 409 just said is taken.
 */
function Candidates({ gapId, disabled, onPick, onRetry }: { gapId: string; disabled: boolean; onPick: (teacherId: string) => void; onRetry: () => void }) {
  const tokens = useTokens();
  const q = useQuery<Candidate[]>(`/manage/substitution/${gapId}/candidates`);
  const note = (text: string, color: string, testID: string) => (
    <Text testID={testID} style={{ paddingHorizontal: 12, paddingVertical: 8, fontFamily: font.sans, fontSize: 13, color }}>{text}</Text>
  );

  if (q.error && !q.data) {
    return (
      <View style={{ paddingBottom: 8 }}>
        {note(q.error.message || 'Could not load who is free.', tokens.color.red, `candidates-error-${gapId}`)}
        <View style={{ paddingHorizontal: 12 }}>
          <Button label="Try again" small variant="ghost" onPress={onRetry} testID={`candidates-retry-${gapId}`} />
        </View>
      </View>
    );
  }
  if (!q.data) return note('Finding who is free…', tokens.color.sub, `candidates-loading-${gapId}`);
  if (q.data.length === 0) return note('Nobody is free that period', tokens.color.sub, `candidates-empty-${gapId}`);
  return (
    <View style={{ marginHorizontal: 12, marginBottom: 10, borderWidth: 1, borderColor: tokens.color.line, borderRadius: tokens.radius.field }}>
      {q.data.map((c, i) => (
        <Row
          key={c.id}
          first={i === 0}
          title={c.name}
          sub={c.teachesSubject ? 'Teaches this subject' : c.coversThatDay > 0 ? `${c.coversThatDay} ${c.coversThatDay === 1 ? 'cover' : 'covers'} that day` : 'No other covers that day'}
          right={<Text style={{ fontFamily: font.sans, fontSize: 14, fontWeight: '700', color: tokens.color.indigo }}>Pick</Text>}
          onPress={() => { if (!disabled) onPick(c.id); }}
          accessibilityLabel={`Give the period to ${c.name}`}
          testID={`candidate-${gapId}-${c.id}`}
        />
      ))}
    </View>
  );
}

/**
 * COVERAGE — the classes the leave she approved left empty, this week.
 *
 * Who is free comes from the server (freeTeachersFor), one gap at a time, so
 * this screen, the console and WhatsApp can never offer different teachers.
 * A covered class says whether its teacher has tapped "Got it".
 */
function Coverage() {
  const tokens = useTokens();
  const from = todayISO();
  const q = useQuery<GapRow[]>(`/manage/leave/coverage?from=${from}&to=${shiftISO(from, 6)}`);
  const [picking, setPicking] = useState<string | null>(null);
  // Bumped to remount the open picker — a retry, or a 409 that changed who is free.
  const [asked, setAsked] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  // Said under the gap it is about — at forty gaps a line at the top is off-screen.
  const [error, setError] = useState<{ gapId: string; text: string } | null>(null);

  /** Forget both answers and ask again — the gaps, and who is free. */
  function lookAgain() {
    invalidate('/manage/leave/coverage');
    invalidate('/manage/substitution');
    setAsked((n) => n + 1);
    q.reload();
  }

  async function act(gapId: string, what: 'assign' | 'clear', substituteTeacherId?: string) {
    if (busy) return;
    setBusy(gapId); setError(null);
    try {
      await api.request(`/manage/substitution/${gapId}/${what}`, { method: 'POST', body: substituteTeacherId ? { substituteTeacherId } : {} });
      setPicking(null);
      // One pick changes who is free for every other gap that period.
      lookAgain();
    } catch (e) {
      // The server's sentence, as it is: "Someone changed this cover a moment ago — …".
      setError({ gapId, text: e instanceof Error ? e.message : 'Could not save that.' });
      if (isConflict(e)) lookAgain();
    } finally {
      setBusy(null);
    }
  }

  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404)) {
    return <Empty kind="locked" title="Cover needs a right">The school admin grants it under Settings → Leave.</Empty>;
  }
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingRows label="classes to cover" />;
  const gaps = q.data;
  const open = gaps.filter((g) => !g.substituteTeacherId).length;

  // Grouped by day: she is looking for "tomorrow's classes", not a flat week.
  const days: { date: string; gaps: GapRow[] }[] = [];
  for (const g of gaps) {
    const key = g.date.slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.date === key) last.gaps.push(g);
    else days.push({ date: key, gaps: [g] });
  }

  return (
    <>
      <PageHeader title={open === 0 ? 'Every class has a teacher' : `${open} ${open === 1 ? 'class needs' : 'classes need'} a teacher`} icon="timetable" />
      {gaps.length === 0 ? (
        <Empty icon="timetable">No approved leave leaves a class empty this week.</Empty>
      ) : (
        days.map((d) => {
          const needs = d.gaps.filter((g) => !g.substituteTeacherId).length;
          return (
            <View key={d.date} style={{ marginBottom: 6 }}>
              <Eyebrow>{`${weekday(d.date)} · ${needs === 0 ? 'all covered' : `${needs} ${needs === 1 ? 'needs' : 'need'} a teacher`}`}</Eyebrow>
              {d.gaps.map((g, i) => {
                const covered = !!g.substituteTeacherId;
                return (
                  <View key={g.id}>
                    <Row
                      first={i === 0}
                      testID={`gap-${g.id}`}
                      title={`${g.classSectionName} · ${g.periodLabel}`}
                      sub={
                        covered
                          ? `${g.substituteTeacherName ?? 'A teacher'} · ${g.acknowledgedAt ? `seen ${seenAt(g.acknowledgedAt)}` : 'not yet seen'}`
                          : `${g.originalTeacherName} on leave`
                      }
                      right={<Pill tone={covered ? 'green' : 'amber'}>{covered ? 'Covered' : 'Needs cover'}</Pill>}
                    />
                    <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 10 }}>
                      <Button
                        label={picking === g.id ? 'Close' : covered ? 'Change' : 'Pick a teacher'}
                        small
                        variant={covered || picking === g.id ? 'ghost' : 'primary'}
                        onPress={() => setPicking(picking === g.id ? null : g.id)}
                        disabled={busy === g.id}
                        testID={`pick-${g.id}`}
                      />
                      {covered ? (
                        <Button label="Clear" small variant="ghost" onPress={() => act(g.id, 'clear')} disabled={busy === g.id} testID={`clear-${g.id}`} />
                      ) : null}
                    </View>
                    {error?.gapId === g.id ? (
                      <Text testID={`coverage-error-${g.id}`} style={{ paddingHorizontal: 12, paddingBottom: 10, fontFamily: font.sans, fontSize: 13, color: tokens.color.red }}>{error.text}</Text>
                    ) : null}
                    {picking === g.id ? (
                      <Candidates
                        key={`${g.id}:${asked}`}
                        gapId={g.id}
                        disabled={busy === g.id}
                        onPick={(teacherId) => act(g.id, 'assign', teacherId)}
                        onRetry={() => { invalidate(`/manage/substitution/${g.id}`); setAsked((n) => n + 1); }}
                      />
                    ) : null}
                  </View>
                );
              })}
            </View>
          );
        })
      )}
    </>
  );
}

/**
 * THE ACCOUNTS OFFICER'S LEAVE DESK — what is waiting on her, and the
 * classes the leave she approved left empty. Pull to refresh forgets both
 * answers and asks again.
 */
export default function LeaveDesk() {
  const [view, setView] = useState<'waiting' | 'coverage'>('waiting');
  const [nonce, setNonce] = useState(0);
  return (
    <Screen
      onRefresh={() => {
        invalidate('/manage/leave');
        invalidate('/manage/substitution');
        setNonce((n) => n + 1);
      }}
      refreshing={false}
    >
      <SectionTitle title="Leave" />
      <Page>
        {/* Inset like every other Page child: the label sat on the card's edge. */}
        <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
          <SegmentedField
            label="Show"
            testID="leavedesk-view"
            value={view}
            onChange={setView}
            options={[{ value: 'waiting', label: 'Waiting' }, { value: 'coverage', label: 'Coverage' }]}
          />
        </View>
        <View key={nonce}>{view === 'waiting' ? <Waiting /> : <Coverage />}</View>
      </Page>
    </Screen>
  );
}
