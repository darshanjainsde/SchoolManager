import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { SyllabusTrackSummary, SyllabusYear } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { useReload } from '@/lib/query';
import { Card, Empty, ErrorState, ListScreen, Pill, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { RingLegend, Rings } from '@/components/Rings';
import { PACE_LABEL, PACE_TONE, ringColors } from '@/lib/syllabus';
import { useTokens } from '@/theme/theme-context';

type Mine = { year: SyllabusYear | null; tracks: SyllabusTrackSummary[] };

/**
 * Syllabus — one card per class and subject the teacher logs, two rings on
 * each (taught vs expected by today), and where the class is now. A card
 * opens the track. `GET /manage/syllabus/mine` is server-scoped: class
 * teacher sections plus the teacher's own timetable slots.
 */
export default function Syllabus() {
  const tokens = useTokens();
  const colors = ringColors(tokens.color);
  const [reloadKey, reload] = useReload();
  const [data, setData] = useState<Mine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      api
        .request<Mine>('/manage/syllabus/mine')
        .then((d) => { if (!cancelled) setData(d); })
        .catch((e: unknown) => {
          if (cancelled) return;
          if (e instanceof ApiError && e.status === 403) setLocked(true);
          else setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => { cancelled = true; };
    }, [reloadKey]),
  );

  const open = (t: SyllabusTrackSummary) => {
    router.push(`/(staff)/(tabs)/home/syllabus/${encodeURIComponent(t.classSectionId)}?subjectId=${encodeURIComponent(t.subjectId)}`);
  };

  if (locked) {
    return (
      <ListScreen data={[]} renderItem={() => null} keyExtractor={() => ''} header={<SectionTitle title="Syllabus" />}
        empty={<Empty kind="locked" title="The syllabus tracker is not on for your school">Ask the office — Sckools switches it on per school, and your classes appear here.</Empty>} />
    );
  }

  const tracks = data?.tracks ?? [];
  const year = data?.year ?? null;
  // Only tracks with chapters are measured: a class teacher holds eight subjects
  // and most have no list yet — those must not drag the average to a false 11%.
  const measured = tracks.filter((t) => t.pace !== 'none');
  const unmeasured = tracks.length - measured.length;
  const behind = measured.filter((t) => t.pace === 'bad' || t.pace === 'warn').length;
  const avg = measured.length ? Math.round(measured.reduce((s, t) => s + t.pct, 0) / measured.length) : 0;

  const header = (
    <View style={{ gap: 12 }}>
      <SectionTitle title="Syllabus" />
      {error && <ErrorState error={error} onRetry={reload} testID="syllabus-error" />}
      {data === null && !error && <LoadingRows label="Loading your classes…" rows={4} />}
      {data && year && tracks.length > 0 && (
        <Card testID="syllabus-hero">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Rings
              outer={{ pct: avg, color: colors.taught, label: 'Taught' }}
              inner={{ pct: year.expectedPct, color: colors.expected, label: 'Expected by today' }}
              size={88} stroke={10} centre={`${avg}%`}
            />
            <View style={{ flex: 1, gap: 8, minWidth: 0 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: tokens.color.ink }}>
                {!measured.length ? 'No chapters yet' : behind ? `${behind} of ${measured.length} ${measured.length === 1 ? 'class' : 'classes'} behind` : measured.length === 1 ? 'On pace' : 'Every class on pace'}
              </Text>
              <RingLegend
                outer={{ pct: avg, color: colors.taught, label: 'Taught (average)' }}
                inner={{ pct: year.expectedPct, color: colors.expected, label: 'Expected by today' }}
              />
              <Text style={{ fontSize: 12.5, color: tokens.color.sub }}>{`${year.name} · ${year.expectedPct}% of working days gone${unmeasured ? ` · ${unmeasured} without chapters` : ''}`}</Text>
            </View>
          </View>
        </Card>
      )}
    </View>
  );

  const empty = data && !error ? (
    !year ? (
      <Empty kind="locked" title="No current session yet" testID="syllabus-no-year">The office sets the school year under Settings. Your classes appear once it is set.</Empty>
    ) : (
      <Empty kind="first" icon="syllabus" title="No classes on your timetable yet" testID="syllabus-empty">Once the office puts you on a class&rsquo;s timetable, or makes you its class teacher, its syllabus appears here.</Empty>
    )
  ) : null;

  return (
    <ListScreen
      data={tracks}
      keyExtractor={(t) => `${t.classSectionId}:${t.subjectId}`}
      header={header}
      empty={empty}
      onRefresh={reload}
      testID="syllabus-list"
      renderItem={(t) => (
        <Pressable
          testID={`syllabus-track-${t.classSectionId}-${t.subjectId}`}
          onPress={() => open(t)}
          accessibilityRole="button"
          accessibilityLabel={`${t.className} ${t.subjectName}, ${PACE_LABEL[t.pace]}, ${t.pct}% taught`}
          style={({ pressed }) => ({ borderRadius: tokens.radius.card, opacity: pressed ? 0.8 : 1 })}
        >
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 88 }}>
            <Rings
              outer={{ pct: t.pct, color: colors.taught, label: 'Taught' }}
              inner={{ pct: t.expectedPct, color: colors.expected, label: 'Expected by today' }}
              size={64} stroke={8} centre={`${t.pct}%`}
            />
            <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: tokens.color.ink }}>{`${t.className} · ${t.subjectName}`}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Pill tone={PACE_TONE[t.pace]}>{PACE_LABEL[t.pace]}</Pill>
                {t.isClassTeacher && <Pill tone="indigo">Class teacher</Pill>}
              </View>
              <Text style={{ fontSize: 13, color: tokens.color.sub }} numberOfLines={1}>
                {t.now ? `Now: ${t.now.title}` : t.leaves ? 'Every chapter done' : 'No chapters yet — add them'}
              </Text>
            </View>
          </Card>
        </Pressable>
      )}
    />
  );
}
