import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { CONCERN_CATEGORY_LABEL, CONCERN_STATUS_LABEL, type ConcernCounts, type ConcernRow } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { Empty, ErrorState, Page, Pill, Screen, SectionTitle } from '@/components/ui';
import { Chip, ChipRow } from '@/components/Chip';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';

/**
 * A CLASS TEACHER'S COMPLAINT BOX on the phone.
 *
 * What the families of THEIR class raised with them — the server decides
 * that, not this screen. Open by default, because the only thing here that
 * is time-bound is a family waiting for an answer.
 */
export default function StaffConcerns() {
  const tokens = useTokens();
  const [rows, setRows] = useState<ConcernRow[] | null>(null);
  const [counts, setCounts] = useState<ConcernCounts | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (all: boolean) => {
    try {
      const [list, c] = await Promise.all([
        api.request<ConcernRow[]>(`/teacher/concerns${all ? '' : '?status=OPEN'}`),
        api.request<ConcernCounts>('/teacher/concerns/counts'),
      ]);
      setRows(list);
      setCounts(c);
      setError(null);
    } catch (e) {
      // Keep whatever was on screen — blanking the rows turned a lost
      // connection into "Nothing open", which is a false answer.
      setError(e instanceof ApiError ? e.message : 'That did not load.');
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(showAll); }, [load, showAll]));

  return (
    <Screen onRefresh={() => void load(showAll)}>
      {/* No second "Complaint Box": the back-chip header already says it (re-audit 2026-10-08). */}
      <Text style={{ fontSize: 14, color: tokens.color.sub, marginTop: 4, lineHeight: 20 }}>
        What the families of your class raised with you. Opening one marks it read — you can answer, or send it to the office.
      </Text>

      {counts ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
          <Stat label="Unread" value={counts.unread} tone={counts.unread ? 'amber' : 'neutral'} />
          <Stat label="Open" value={counts.open} tone="neutral" />
          <Stat label="Resolved" value={counts.resolvedThisMonth} tone={counts.resolvedThisMonth ? 'green' : 'neutral'} />
        </View>
      ) : null}

      {error && rows !== null ? <Text style={{ marginTop: 10, fontSize: 13, color: tokens.color.red }}>{error}</Text> : null}

      <ChipRow style={{ marginTop: 14 }}>
        <Chip label="Open" selected={!showAll} onPress={() => setShowAll(false)} />
        <Chip label="All" selected={showAll} onPress={() => setShowAll(true)} />
      </ChipRow>

      <SectionTitle title={showAll ? 'Everything' : 'Open'} />
      {rows === null && error ? <ErrorState error={error} onRetry={() => void load(showAll)} /> : rows === null ? <LoadingRows label="Loading concerns" rows={3} /> : rows.length === 0 ? (
        <Empty icon="concern">
          {showAll ? 'Nothing has been raised with you yet.' : 'Nothing open. A family of your class can write to you from their app.'}
        </Empty>
      ) : (
        <Page>
          {rows.map((r, i) => (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              testID={`t-concern-${r.id}`}
              onPress={() => router.push(`/(staff)/(tabs)/home/concerns/${r.id}`)}
              style={({ pressed }) => ({ paddingVertical: 12, paddingHorizontal: 16, gap: 4, minHeight: 72, justifyContent: 'center', borderTopWidth: i === 0 ? 0 : 1, borderTopColor: tokens.color.line, opacity: pressed ? 0.8 : 1 })}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {r.unread && <View accessibilityLabel="unread" style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: tokens.color.indigo }} />}
                <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: tokens.color.ink }} numberOfLines={1}>{r.title}</Text>
                <Pill tone={r.status === 'RESOLVED' ? 'green' : r.status === 'IN_PROGRESS' ? 'amber' : 'indigo'}>
                  {CONCERN_STATUS_LABEL[r.status]}
                </Pill>
              </View>
              <Text style={{ fontSize: 13, color: tokens.color.sub }}>
                {CONCERN_CATEGORY_LABEL[r.category]} · {r.student.name}{r.student.className ? ` · ${r.student.className}` : ''}
              </Text>
            </Pressable>
          ))}
        </Page>
      )}
    </Screen>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'green' | 'neutral' }) {
  const tokens = useTokens();
  const fg = tone === 'amber' ? tokens.color.late : tone === 'green' ? tokens.color.green : tokens.color.ink;
  return (
    <View style={{ flex: 1, borderWidth: 1, borderColor: tokens.color.line, borderRadius: tokens.radius.field, padding: 12, backgroundColor: tokens.color.surface }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: tokens.color.sub }}>{label}</Text>
      <Text style={{ fontSize: 20, fontWeight: '800', color: fg, marginTop: 2 }}>{value}</Text>
    </View>
  );
}
