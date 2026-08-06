import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { formatDate, type PublishedResult, type UpcomingExam } from '@/lib/portal';
import { Card, Page, Pill, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { DUR, inkWidth, play, useReduceMotion } from '@/theme/motion';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/** marks/maxMarks as a 0-100 percentage, guarding a zero/absent denominator — ported from apps/web/app/portal/results/page.tsx. */
function pct(marks: number, maxMarks: number): number {
  if (!maxMarks) return 0;
  return Math.round((marks / maxMarks) * 100);
}

/** Height of the expanded `.det` drawer — two labelled bars and their gaps. */
const DETAIL_HEIGHT = 64;

/**
 * The `.det` reveal: a drawer that rolls open on tap rather than appearing.
 *
 * WHY: the two bars inside are a COMPARISON (this mark against the class),
 * and a comparison that pops into existence invites the eye to read it as a
 * new fact. Rolling it out of the row it belongs to keeps it attached to the
 * result it explains. `native: false` — height and width are layout props,
 * which the UI-thread driver cannot touch.
 *
 * The same 0→1 value drives the bars' width, so THE INK LINE is literally
 * drawn by the act of opening: the marks are inked in as the drawer travels.
 */
function useReveal(open: boolean): Animated.Value {
  const v = useRef(new Animated.Value(0)).current;
  const reduced = useReduceMotion();
  useEffect(() => {
    play(v, DUR.screen, { reduced: reduced.current, native: false, toValue: open ? 1 : 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return v;
}

function NextTestCard({ exam }: { exam: UpcomingExam }) {
  const tokens = useTokens();
  return (
    <Card testID="next-test-card" style={{ gap: 4 }}>
      <Text
        style={{ fontSize: 9.5, fontWeight: '800', letterSpacing: 1, color: tokens.color.indigo }}
      >
        NEXT TEST
      </Text>
      <Text style={{ fontFamily: font.serif, fontSize: 16, color: tokens.color.ink }}>
        {exam.subjectName} · {exam.title}
      </Text>
      <Text style={{ fontFamily: font.mono, fontSize: 11, color: tokens.color.sub, marginTop: 1 }}>
        {formatDate(exam.scheduledAt)} · out of {exam.maxMarks}
      </Text>
      {exam.syllabus && (
        <Text style={{ fontSize: 12, color: tokens.color.ink2 }}>Syllabus: {exam.syllabus}</Text>
      )}
    </Card>
  );
}

/** One `.bar`: a label line and the rule that fills to the score. */
function ScoreBar({
  label,
  value,
  percent,
  color,
  v,
}: {
  label: string;
  value: number;
  percent: number;
  color: string;
  v: Animated.Value;
}) {
  const tokens = useTokens();
  return (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, marginBottom: 3 }}>
        <Text style={{ fontSize: 9, color: tokens.color.sub }}>{label}</Text>
        <Text style={{ fontFamily: font.mono, fontSize: 9, color: tokens.color.sub }}>{value}</Text>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: tokens.radius.chip,
          backgroundColor: tokens.color.line,
          overflow: 'hidden',
        }}
      >
        <Animated.View
          style={{
            height: '100%',
            width: inkWidth(v, percent),
            borderRadius: tokens.radius.chip,
            backgroundColor: color,
          }}
        />
      </View>
    </>
  );
}

/**
 * One `.res` row: subject, paper, the mark, and how it sat against the class.
 * Tap to roll out the two comparison bars.
 *
 * NO STAMP ON THE MARK. The repaint wrapped the score in `stampStyle`, whose
 * resting state is `rotate(-2deg)` — so every mark on the page stayed
 * permanently crooked — and staggered the landing by `250 + index * 220`ms,
 * which left the tenth result's mark INVISIBLE for well over two seconds after
 * the page had otherwise finished loading. The mark is the one thing this
 * screen exists to show; it does not get to arrive late or off square.
 */
function ResultRow({ r, first }: { r: PublishedResult; first: boolean }) {
  const tokens = useTokens();
  const [open, setOpen] = useState(false);
  const reveal = useReveal(open);

  const diff = Math.round((r.marks - r.classAverage) * 10) / 10;
  const tone = diff > 0 ? 'green' : diff < 0 ? 'amber' : 'neutral';
  const diffLabel =
    diff > 0 ? `${diff} above average` : diff < 0 ? `${Math.abs(diff)} below average` : 'Exactly average';

  return (
    <Pressable
      testID={`result-${r.examId}`}
      accessibilityRole="button"
      onPress={() => setOpen((o) => !o)}
      style={{
        paddingVertical: 11,
        paddingHorizontal: 13,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: tokens.color.line,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>{r.subjectName}</Text>
          <Text style={{ fontSize: 12, color: tokens.color.sub, marginTop: 1 }}>{r.title}</Text>
        </View>
        <Text style={{ fontSize: 16, fontWeight: '800', color: tokens.color.ink }}>
          {r.marks}
          <Text style={{ fontSize: 12, fontWeight: '600', color: tokens.color.sub }}>/{r.maxMarks}</Text>
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7, flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 11, color: tokens.color.sub }}>
          Class average: {r.classAverage}/{r.maxMarks}
        </Text>
        <Pill tone={tone}>{diffLabel}</Pill>
      </View>

      <Animated.View
        style={{
          height: reveal.interpolate({ inputRange: [0, 1], outputRange: [0, DETAIL_HEIGHT] }),
          overflow: 'hidden',
        }}
      >
        <ScoreBar
          label="this paper"
          value={r.marks}
          percent={pct(r.marks, r.maxMarks)}
          color={tokens.color.indigo}
          v={reveal}
        />
        <ScoreBar
          label="class average"
          value={r.classAverage}
          percent={pct(r.classAverage, r.maxMarks)}
          color={tokens.color.line2}
          v={reveal}
        />
      </Animated.View>
    </Pressable>
  );
}

/**
 * Published results + the next-test detail — mirrors the web's
 * `/portal/results` (apps/web/app/portal/results/page.tsx). The next-test
 * card is what home's banner tap opens into: syllabus, max marks, date —
 * more detail than the compact home banner shows. No push wiring here;
 * that needs `NotificationOutbox` (Phase 4) — this screen only reads the
 * existing `/me/results` and `/me/exams` endpoints.
 */
export default function Results() {
  const tokens = useTokens();
  const [results, setResults] = useState<PublishedResult[] | null>(null);
  const [exams, setExams] = useState<UpcomingExam[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      Promise.all([
        api.request<PublishedResult[]>('/me/results'),
        api.request<UpcomingExam[]>('/me/exams'),
      ])
        .then(([res, ex]) => {
          if (cancelled) return;
          setResults(res);
          setExams(ex);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const nextExam = exams?.[0] ?? null;

  return (
    <Screen>
      <SectionTitle title="Results" />

      {error && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{error}</Text>
        </Card>
      )}
      {results === null && !error && (
        <LoadingRows label="Loading results…" rows={4} />
      )}

      {results !== null && !error && (
        <>
          {nextExam && <NextTestCard exam={nextExam} />}

          <SectionTitle title="Published results" />
          {results.length === 0 ? (
            <Card>
              <Text style={{ color: tokens.color.sub }}>No results published yet.</Text>
            </Card>
          ) : (
            <>
              <Text style={{ fontSize: 11, color: tokens.color.sub, marginHorizontal: 4, marginTop: -4 }}>
                Tap a result to see it against the class.
              </Text>
              {/* One sheet of paper, ruled between results — the pitch's
                  `.page` holding a run of `.res` rows. */}
              <Page>
                {results.map((r, i) => (
                  <ResultRow key={r.examId} r={r} first={i === 0} />
                ))}
              </Page>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
