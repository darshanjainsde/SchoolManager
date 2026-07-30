import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { formatDate, type PublishedResult, type UpcomingExam } from '@/lib/portal';
import { Card, Pill, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';

/** marks/maxMarks as a 0-100 percentage, guarding a zero/absent denominator — ported from apps/web/app/portal/results/page.tsx. */
function pct(marks: number, maxMarks: number): number {
  if (!maxMarks) return 0;
  return Math.round((marks / maxMarks) * 100);
}

function NextTestCard({ exam }: { exam: UpcomingExam }) {
  const tokens = useTokens();
  return (
    <Card testID="next-test-card" style={{ gap: 4 }}>
      <Text style={{ fontSize: 10.5, fontWeight: '700', color: tokens.color.indigo }}>NEXT TEST</Text>
      <Text style={{ fontSize: 15, fontWeight: '800', color: tokens.color.ink }}>
        {exam.subjectName} · {exam.title}
      </Text>
      <Text style={{ fontSize: 12, color: tokens.color.sub, marginTop: 1 }}>
        {formatDate(exam.scheduledAt)} · out of {exam.maxMarks}
      </Text>
      {exam.syllabus && (
        <Text style={{ fontSize: 12, color: tokens.color.sub }}>Syllabus: {exam.syllabus}</Text>
      )}
    </Card>
  );
}

function ResultCard({ r }: { r: PublishedResult }) {
  const tokens = useTokens();
  const diff = Math.round((r.marks - r.classAverage) * 10) / 10;
  const tone = diff > 0 ? 'green' : diff < 0 ? 'amber' : 'neutral';
  const diffLabel = diff > 0 ? `${diff} above average` : diff < 0 ? `${Math.abs(diff)} below average` : 'Exactly average';

  return (
    <Card testID={`result-${r.examId}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>{r.subjectName}</Text>
          <Text style={{ fontSize: 12, color: tokens.color.sub, marginTop: 1 }}>{r.title}</Text>
        </View>
        <Text style={{ fontSize: 16, fontWeight: '800', color: tokens.color.ink }}>
          {r.marks}
          <Text style={{ fontSize: 12, fontWeight: '600', color: tokens.color.sub }}>/{r.maxMarks}</Text>
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 11.5, color: tokens.color.sub }}>
          Class average: {r.classAverage}/{r.maxMarks}
        </Text>
        <Pill tone={tone}>{diffLabel}</Pill>
      </View>
    </Card>
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
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading results…</Text>
        </Card>
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
            results.map((r) => <ResultCard key={r.examId} r={r} />)
          )}
        </>
      )}
    </Screen>
  );
}
