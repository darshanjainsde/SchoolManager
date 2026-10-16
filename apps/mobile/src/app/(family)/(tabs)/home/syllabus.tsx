import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { StudentSyllabusHome, StudentSyllabusSubject } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { useReload } from '@/lib/query';
import { Card, Empty, ErrorState, ListScreen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { RingLegend, Rings } from '@/components/Rings';
import { ringColors } from '@/lib/syllabus';
import { useTokens } from '@/theme/theme-context';

/**
 * Syllabus — the child's side. One card per subject with two rings: what the
 * class has been taught (green) and what I have revised (blue — a topic
 * counts once I write a note on it). The blue ring smaller than the green
 * one is the whole message.
 */
export default function FamilySyllabus() {
  const tokens = useTokens();
  const colors = ringColors(tokens.color);
  const [reloadKey, reload] = useReload();
  const [data, setData] = useState<StudentSyllabusHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      api
        .request<StudentSyllabusHome>('/me/syllabus')
        .then((d) => { if (!cancelled) setData(d); })
        .catch((e: unknown) => {
          if (cancelled) return;
          if (e instanceof ApiError && e.status === 403) setLocked(true);
          else setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => { cancelled = true; };
    }, [reloadKey]),
  );

  if (locked) {
    return (
      <ListScreen data={[]} renderItem={() => null} keyExtractor={() => ''} header={<SectionTitle title="Syllabus" />}
        empty={<Empty kind="locked" title="The syllabus tracker is not on for your school">Ask the office — once it is on, every subject appears here with where the class has reached.</Empty>} />
    );
  }

  const subjects = data?.subjects ?? [];
  const toRevise = subjects.reduce((n, s) => n + Math.max(0, s.done - s.revised), 0);
  const avg = (k: 'pct' | 'revisedPct') => (subjects.length ? Math.round(subjects.reduce((a, s) => a + s[k], 0) / subjects.length) : 0);

  const header = (
    <View style={{ gap: 12 }}>
      <SectionTitle title="Syllabus" />
      {error && <ErrorState error={error} onRetry={reload} testID="syllabus-error" />}
      {data === null && !error && <LoadingRows label="Loading your subjects…" rows={4} />}
      {data && subjects.length > 0 && (
        <Card testID="syllabus-hero">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Rings
              outer={{ pct: avg('pct'), color: colors.taught, label: 'Taught' }}
              inner={{ pct: avg('revisedPct'), color: colors.revised, label: 'Revised by me' }}
              size={88} stroke={10} centre={`${avg('pct')}%`}
            />
            <View style={{ flex: 1, gap: 8, minWidth: 0 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: tokens.color.ink }}>
                {toRevise ? `${toRevise} taught ${toRevise === 1 ? 'topic' : 'topics'} to revise` : 'Everything taught is revised'}
              </Text>
              <RingLegend
                outer={{ pct: avg('pct'), color: colors.taught, label: 'Taught (average)' }}
                inner={{ pct: avg('revisedPct'), color: colors.revised, label: 'Revised by me' }}
              />
              <Text style={{ fontSize: 12.5, color: tokens.color.sub }}>{`${data.className ?? ''}${data.year ? ` · ${data.year.name}` : ''}`}</Text>
            </View>
          </View>
        </Card>
      )}
    </View>
  );

  const empty = data && !error ? (
    !data.className ? (
      <Empty kind="locked" title="You are not in a class yet" testID="syllabus-no-class">Once the office puts you in one, your subjects appear here.</Empty>
    ) : (
      <Empty kind="first" icon="syllabus" title="No chapters yet" testID="syllabus-empty">Your teachers add the chapter lists, and this fills in.</Empty>
    )
  ) : null;

  const open = (s: StudentSyllabusSubject) => router.push(`/(family)/(tabs)/home/syllabus/${encodeURIComponent(s.subjectId)}`);

  return (
    <ListScreen
      data={subjects}
      keyExtractor={(s) => s.subjectId}
      header={header}
      empty={empty}
      onRefresh={reload}
      testID="syllabus-list"
      renderItem={(s) => (
        <Pressable
          testID={`syllabus-subject-${s.subjectId}`}
          onPress={() => open(s)}
          accessibilityRole="button"
          accessibilityLabel={`${s.subjectName}, ${s.pct}% taught, ${s.revisedPct}% revised`}
          style={({ pressed }) => ({ borderRadius: tokens.radius.card, opacity: pressed ? 0.8 : 1 })}
        >
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 88 }}>
            <Rings
              outer={{ pct: s.pct, color: colors.taught, label: 'Taught' }}
              inner={{ pct: s.revisedPct, color: colors.revised, label: 'Revised by me' }}
              size={64} stroke={8} centre={`${s.pct}%`}
            />
            <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: tokens.color.ink }}>{s.subjectName}</Text>
              <Text style={{ fontSize: 13, color: tokens.color.sub }}>
                {`${s.teacher ?? 'Teacher not on the timetable'} · ${s.done} of ${s.leaves} taught · ${s.revised} revised`}
              </Text>
              <Text style={{ fontSize: 13, color: tokens.color.ink }} numberOfLines={1}>
                {s.now ? `Now: ${s.now.title}` : s.leaves ? 'Every chapter done' : 'No chapters yet'}
              </Text>
            </View>
          </Card>
        </Pressable>
      )}
    />
  );
}
