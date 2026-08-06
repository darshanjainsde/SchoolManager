import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Pressable, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import type {
  Exam,
  ExamList,
  PublishResultsResponse,
  RosterStudent,
  SavedResult,
  SaveResultsResponse,
} from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { buildResultsPayload, markOutOfRange, marksValid } from '@/lib/exams';
import { Card, Pill, Screen, SectionTitle, Toast } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';
import { DUR, inkWidth, play, stampStyle, useGesture, useReduceMotion } from '@/theme/motion';

/**
 * THE INK LINE (`.mprog`) — a rule drawing itself along as the sheet fills.
 * Entering marks is the one long, repetitive job on this app, and the only
 * thing that makes a long job bearable is seeing the line move. It re-aims at
 * the new fraction on every keystroke rather than restarting from zero, so
 * the line only ever grows the way a pen only ever moves forward.
 */
function InkProgress({ done, total }: { done: number; total: number }) {
  const tokens = useTokens();
  const fraction = total > 0 ? Math.min(1, done / total) : 0;
  const line = useRef(new Animated.Value(0)).current;
  const reduced = useReduceMotion();
  useEffect(() => {
    play(line, DUR.ink, { reduced: reduced.current, native: false, toValue: fraction });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fraction]);
  return (
    <View
      style={{
        height: 6,
        borderRadius: 999,
        backgroundColor: tokens.color.line,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={{
          height: '100%',
          borderRadius: 999,
          backgroundColor: tokens.color.indigo,
          // The value itself carries the fraction, so `inkWidth` maps the full
          // 0→1 range onto 0→100% of the rule.
          width: inkWidth(line, 100),
        }}
      />
    </View>
  );
}

/**
 * THE STAMP (`.bigstamp`) — the sheet stamps itself the moment the last mark
 * lands. This is the only signal in the flow that says "you are done here",
 * and it arrives before any button is pressed precisely because a teacher
 * scanning back for the one blank row is the thing it replaces.
 */
function CompleteStamp({ label }: { label: string }) {
  const tokens = useTokens();
  const land = useGesture(true, DUR.stamp);
  return (
    <View style={{ alignItems: 'center' }}>
      <Animated.View
        style={[
          {
            borderWidth: 2.5,
            borderColor: tokens.color.green,
            borderRadius: 10,
            paddingVertical: 6,
            paddingHorizontal: 16,
          },
          stampStyle(land),
        ]}
      >
        <Text style={{ fontFamily: font.serif, fontWeight: '700', fontSize: 15, color: tokens.color.green }}>
          {label}
        </Text>
      </Animated.View>
    </View>
  );
}

/**
 * Exact wording the web's ConfirmPublish dialog uses
 * (apps/web/app/teacher/results/page.tsx) — the two clients must never
 * promise different things before the single most consequential action a
 * teacher can take (marks become visible to families and get emailed).
 */
const PUBLISH_WARNING =
  'Publishing makes every saved mark visible to students and parents, and emails them that ' +
  'results are out. Save any pending marks first — only marks already saved get published.';

export default function ExamResults() {
  const tokens = useTokens();
  // `.mkrow input` — a small mono box, because a column of marks is a column
  // of figures and figures only line up in a mono face.
  const inputStyle = {
    borderWidth: 1.5,
    borderColor: tokens.color.line,
    borderRadius: 9,
    paddingVertical: 7,
    paddingHorizontal: 6,
    fontFamily: font.mono,
    fontSize: 13,
    fontWeight: '700' as const,
    color: tokens.color.ink,
    backgroundColor: tokens.color.appBg,
    width: 56,
    textAlign: 'center' as const,
  };
  // `.mkrow input.doneIn` — a filled, in-range box turns green-tinted. Not a
  // reward: it is how a teacher's eye finds the ONE row still blank without
  // re-reading forty names.
  const doneInputStyle = {
    borderColor: tokens.color.green,
    backgroundColor: tokens.color.green50,
    color: tokens.color.green,
  };
  const { examId, classSectionId } = useLocalSearchParams<{
    examId: string;
    classSectionId: string;
  }>();

  const [examList, setExamList] = useState<ExamList | null>(null);
  const [examListError, setExamListError] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterStudent[] | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedResult[] | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);

  // Kept as raw strings, exactly like the web, so a half-typed value (or a
  // blank one) never becomes NaN mid-keystroke.
  const [entries, setEntries] = useState<Record<string, string>>({});
  const seededRef = useRef(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<SaveResultsResponse | null>(null);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<PublishResultsResponse | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setExamListError(null);
      api
        .request<ExamList>(`/manage/exams?classSectionId=${encodeURIComponent(classSectionId ?? '')}`)
        .then((data) => {
          if (!cancelled) setExamList(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setExamListError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, [classSectionId]),
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setRosterError(null);
      api
        .request<RosterStudent[]>(`/manage/students?classSectionId=${encodeURIComponent(classSectionId ?? '')}`)
        .then((data) => {
          if (!cancelled) setRoster(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setRosterError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, [classSectionId]),
  );

  const refetchSaved = useCallback(() => {
    setSavedError(null);
    return api
      .request<SavedResult[]>(`/manage/exams/${encodeURIComponent(examId ?? '')}/results`)
      .then((data) => setSaved(data))
      .catch((e: unknown) => setSavedError(e instanceof ApiError ? e.message : 'Something went wrong.'));
  }, [examId]);

  useFocusEffect(
    useCallback(() => {
      void refetchSaved();
    }, [refetchSaved]),
  );

  // Seed the inputs from the saved marks once — keyed on a ref (not
  // examId/saved.data identity) because this screen is mounted once per
  // exam; typing must never get clobbered by a background refetch of the
  // same exam's already-saved marks.
  useEffect(() => {
    if (!saved || seededRef.current) return;
    seededRef.current = true;
    setEntries(Object.fromEntries(saved.map((r) => [r.studentId, String(r.marks)])));
  }, [saved]);

  const exam: Exam | undefined = [...(examList?.past ?? []), ...(examList?.upcoming ?? [])].find(
    (e) => e.id === examId,
  );
  const students = roster ?? [];
  const alreadyPublished = (saved ?? []).some((r) => r.publishedAt !== null);
  const publishedAt = (saved ?? []).find((r) => r.publishedAt !== null)?.publishedAt ?? null;

  const parsed = buildResultsPayload(students, entries);
  // The out-of-range guard: nothing gets saved unless every parsed mark is
  // finite and within 0..maxMarks. Deleting this check (or marksValid's own
  // range test) would let an out-of-range batch reach the PUT below.
  const valid = !!exam && marksValid(parsed, exam.maxMarks);

  const save = async () => {
    if (!valid || saving || !exam) return;
    setSaving(true);
    setSaveError(null);
    setSaveResult(null);
    try {
      const result = await api.request<SaveResultsResponse>(
        `/manage/exams/${encodeURIComponent(exam.id)}/results`,
        { method: 'PUT', body: { marks: parsed } },
      );
      setSaveResult(result);
      await refetchSaved();
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Could not save marks.');
    } finally {
      setSaving(false);
    }
  };

  const doPublish = async () => {
    if (!exam) return;
    setPublishing(true);
    setPublishError(null);
    setPublishResult(null);
    try {
      const result = await api.request<PublishResultsResponse>(
        `/manage/exams/${encodeURIComponent(exam.id)}/publish`,
        { method: 'POST' },
      );
      setPublishResult(result);
      await refetchSaved();
    } catch (e) {
      setPublishError(e instanceof ApiError ? e.message : 'Could not publish results.');
    } finally {
      setPublishing(false);
    }
  };

  // The publish-confirm gate. Deleting this wrapper (having the button call
  // doPublish directly) fires publish immediately with no dialog — and
  // fails the "cancel fires nothing" test, since there is then no Cancel
  // button to press at all.
  const confirmPublish = () => {
    if (!exam) return;
    Alert.alert(`Publish results for ${exam.title}?`, PUBLISH_WARNING, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes, publish', style: 'destructive', onPress: () => void doPublish() },
    ]);
  };

  return (
    <Screen>
      <SectionTitle title={exam ? `${exam.title} · Results` : 'Results'} />

      {examListError && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{examListError}</Text>
        </Card>
      )}
      {rosterError && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{rosterError}</Text>
        </Card>
      )}
      {savedError && (
        <Card>
          <Text testID="saved-error" style={{ color: tokens.color.red }}>
            {savedError}
          </Text>
        </Card>
      )}

      {!examListError && !exam && examList !== null && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Test not found for this class.</Text>
        </Card>
      )}

      {exam && (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            {/* The running count stays HERE, above the sheet. The repaint
                moved it under the ink line at the foot of the list — which on
                a class of forty is several screens down, so "how many are
                still blank" stopped being answerable without scrolling to the
                bottom. The line below still draws it; this states it. */}
            <Text style={{ fontFamily: font.serif, fontWeight: '700', fontSize: 15, color: tokens.color.ink }}>
              Out of {exam.maxMarks} · {parsed.length} of {students.length} entered
            </Text>
            {alreadyPublished && <Pill tone="green">Published</Pill>}
          </View>
          {alreadyPublished && publishedAt && (
            <Text testID="published-at" style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 6 }}>
              Published {new Date(publishedAt).toLocaleString()}
            </Text>
          )}
        </Card>
      )}

      {exam && roster === null && !rosterError && (
        <LoadingRows label="Loading roster…" rows={8} />
      )}

      {exam && students.length === 0 && roster !== null && !rosterError && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>No students in this class yet.</Text>
        </Card>
      )}

      {exam && students.length > 0 && (
        <Card style={{ paddingVertical: 2 }}>
          {/* `.mkrow` — roll, name, box. The roll leads the row (as it does on
              a paper mark sheet) so the teacher can read down a dictated list
              of numbers without hunting for names. */}
          {students.map((s) => {
            const raw = entries[s.id] ?? '';
            const bad = markOutOfRange(raw, exam.maxMarks);
            const filled = raw.trim().length > 0 && !bad;
            return (
              <View
                key={s.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 9,
                  paddingVertical: 7,
                  borderBottomWidth: 1,
                  borderBottomColor: tokens.color.line,
                }}
              >
                <Text
                  style={{
                    fontFamily: font.mono,
                    fontSize: 10.5,
                    color: tokens.color.sub,
                    width: 24,
                    textAlign: 'right',
                  }}
                >
                  {s.rollNo ?? '—'}
                </Text>
                <Text style={{ fontWeight: '600', fontSize: 13, color: tokens.color.ink, flex: 1 }}>
                  {s.firstName} {s.lastName}
                </Text>
                <TextInput
                  testID={`mark-${s.id}`}
                  value={raw}
                  onChangeText={(v) => setEntries((m) => ({ ...m, [s.id]: v }))}
                  keyboardType="numeric"
                  placeholder="—"
                  placeholderTextColor={tokens.color.placeholder}
                  style={[
                    inputStyle,
                    filled ? doneInputStyle : null,
                    bad ? { borderColor: tokens.color.red, color: tokens.color.red } : null,
                  ]}
                />
              </View>
            );
          })}
          {/* THE INK LINE plus its count — the pitch's `.mprog` + `#mkcount`. */}
          <View style={{ paddingTop: 10, paddingBottom: 12, gap: 4 }}>
            <InkProgress done={parsed.length} total={students.length} />
            <Text style={{ fontSize: 10, color: tokens.color.sub }}>
              {parsed.length} of {students.length} entered
            </Text>
          </View>
        </Card>
      )}

      {exam && students.length > 0 && valid && parsed.length === students.length && (
        <CompleteStamp label={`All ${students.length} in ✓`} />
      )}

      {exam && parsed.length > 0 && !valid && (
        <Text testID="marks-range-error" style={{ color: tokens.color.red, fontSize: 12.5, marginHorizontal: 4 }}>
          Every mark must be between 0 and {exam.maxMarks}.
        </Text>
      )}

      {saveError && (
        <Text testID="save-error" style={{ color: tokens.color.red, fontSize: 12.5, marginHorizontal: 4 }}>
          {saveError}
        </Text>
      )}
      {publishError && (
        <Text testID="publish-error" style={{ color: tokens.color.red, fontSize: 12.5, marginHorizontal: 4 }}>
          {publishError}
        </Text>
      )}

      {exam && students.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            testID="save-marks"
            disabled={!valid || saving}
            onPress={() => void save()}
            style={{
              flex: 1,
              backgroundColor: tokens.color.indigo,
              borderRadius: 13,
              padding: 12,
              opacity: !valid || saving ? 0.6 : 1,
            }}
          >
            <Text style={{ color: tokens.color.onBrand, fontWeight: '700', textAlign: 'center', fontSize: 13 }}>
              {saving ? 'Saving…' : 'Save marks'}
            </Text>
          </Pressable>
          {!alreadyPublished && (
            <Pressable
              testID="publish-results"
              disabled={publishing}
              onPress={confirmPublish}
              style={{
                flex: 1,
                backgroundColor: tokens.color.amber50,
                borderRadius: 13,
                padding: 12,
                opacity: publishing ? 0.6 : 1,
              }}
            >
              <Text style={{ color: tokens.color.late, fontWeight: '700', textAlign: 'center', fontSize: 13 }}>
                {publishing ? 'Publishing…' : 'Publish results'}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {saveResult && (
        <Toast
          kind="success"
          testID="save-success"
          message={`Saved marks for ${saveResult.saved} students.`}
        />
      )}
      {publishResult && (
        <Toast
          kind="success"
          testID="publish-success"
          message={
            publishResult.published === 0
              ? 'Nothing to publish — save some marks first.'
              : `Published ${publishResult.published} results. Students and parents are being emailed.`
          }
        />
      )}
    </Screen>
  );
}
