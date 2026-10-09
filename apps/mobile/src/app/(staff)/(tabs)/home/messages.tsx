import { useCallback, useState, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { MessageThreadRow } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { Card, Empty, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { fmtDayTime } from '@/lib/dates';

/** "AS" for Aarav Sharma — the pitch's `.mrow .av` initials disc. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase();
}

function formatWhen(iso: string): string {
  return fmtDayTime(iso);
}

/**
 * Messages — the teacher side of T17. `GET /manage/messages` returns only the
 * threads whose teacherId is the caller (server-enforced), newest-first by
 * `lastMessageAt` so a fresh student question surfaces at the top. Tapping a
 * thread opens it and lets the teacher reply.
 */
export default function StaffMessages() {
  const tokens = useTokens();
  const [threads, setThreads] = useState<MessageThreadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      api
        .request<MessageThreadRow[]>('/manage/messages')
        .then((data) => {
          if (!cancelled) setThreads(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // O(n log n) Date constructions on every render before (perf audit 2026-09-22, #18).

  const sorted = useMemo(() => (threads ?? [])
    .slice()
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()), [threads]);

  return (
    <Screen>
      <SectionTitle title="Messages" />

      {error && (
        <Card>
          <Text testID="threads-error" style={{ color: tokens.color.red }}>
            {error}
          </Text>
        </Card>
      )}
      {threads === null && !error && (
        <LoadingRows label="Loading messages…" rows={5} />
      )}
      {threads?.length === 0 && !error && (
        <Card style={{ padding: 0 }}>
          <Empty kind="first" icon="messages" title="No questions yet">When a family in your classes writes to you, it lands here and rings the bell. Only the classes you teach can reach you.</Empty>
        </Card>
      )}
      {sorted.map((t) => (
        <Pressable
          key={t.id}
          testID={`thread-${t.id}`}
          onPress={() => router.push(`/(staff)/(tabs)/home/messages/${t.id}`)}
          accessibilityRole="button"
          style={({ pressed }) => ({ minHeight: 72, borderRadius: tokens.radius.card, opacity: pressed ? 0.8 : 1 })}
          >
          {/* `.mrow` — an initials disc, the thread, and the unread count. A
              conversation is with a PERSON, and a disc bearing their initials
              is the cheapest way to say so on a list of otherwise identical
              rows. */}
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72 }}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 999,
                backgroundColor: tokens.color.indigo50,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '800', color: tokens.color.indigo }}>
                {initials(t.studentName)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: tokens.color.ink }}>
                  {t.studentName}
                </Text>
                <Text style={{ fontSize: 13, color: tokens.color.sub }}>{formatWhen(t.lastMessageAt)}</Text>
              </View>
              <Text style={{ fontSize: 13, color: tokens.color.indigo, marginTop: 1 }}>{t.subjectName}</Text>
              {t.lastMessagePreview && (
                <Text style={{ fontSize: 13, color: tokens.color.sub, marginTop: 3 }} numberOfLines={1}>
                  {t.lastMessagePreview}
                </Text>
              )}
            </View>
            {t.unreadCount > 0 && (
              <View
                testID={`thread-unread-${t.id}`}
                style={{
                  minWidth: 24,
                  height: 24,
                  borderRadius: 999,
                  paddingHorizontal: 6,
                  backgroundColor: tokens.color.indigo,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: tokens.color.onBrand, fontSize: 13, fontWeight: '800' }}>{t.unreadCount}</Text>
              </View>
            )}
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
