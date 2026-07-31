import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { MessageThreadRow } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
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

  const sorted = (threads ?? [])
    .slice()
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

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
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading messages…</Text>
        </Card>
      )}
      {threads?.length === 0 && !error && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>No student questions yet.</Text>
        </Card>
      )}
      {sorted.map((t) => (
        <Pressable
          key={t.id}
          testID={`thread-${t.id}`}
          onPress={() => router.push(`/(staff)/messages/${t.id}`)}
        >
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>{t.studentName}</Text>
                <Text style={{ fontSize: 11, color: tokens.color.sub }}>{formatWhen(t.lastMessageAt)}</Text>
              </View>
              <Text style={{ fontSize: 11.5, color: tokens.color.indigo, marginTop: 1 }}>{t.subjectName}</Text>
              {t.lastMessagePreview && (
                <Text style={{ fontSize: 12, color: tokens.color.sub, marginTop: 3 }} numberOfLines={1}>
                  {t.lastMessagePreview}
                </Text>
              )}
            </View>
            {t.unreadCount > 0 && (
              <View
                testID={`thread-unread-${t.id}`}
                style={{
                  minWidth: 22,
                  height: 22,
                  borderRadius: 11,
                  paddingHorizontal: 6,
                  backgroundColor: tokens.color.indigo,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: tokens.color.onBrand, fontSize: 11, fontWeight: '800' }}>{t.unreadCount}</Text>
              </View>
            )}
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
