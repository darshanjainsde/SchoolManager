import { useCallback, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  MESSAGE_BODY_MAX,
  type MessageThreadDetail,
  type MessageThreadRow,
  type MessageableTeacher,
} from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';

/** A real timestamp, read in the device's own local time — mirrors `(family)/notices.tsx`. */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Messages — the student side of T17. A student picks one of the teachers who
 * actually teaches them a subject this week (server-derived from the
 * timetable via `GET /me/messages/teachers`, never a free id) and asks a
 * question; the teacher's reply shows at the top of the thread list ("response
 * at the top" — threads are ordered newest-first by `lastMessageAt`).
 *
 * Role-neutral throughout: parents and students share one STUDENT login, so
 * copy says "your teacher", never "your child's teacher".
 */
export default function Messages() {
  const tokens = useTokens();
  const inputStyle = {
    borderWidth: 1,
    borderColor: tokens.color.line,
    borderRadius: 11,
    padding: 11,
    fontSize: 13.5,
    color: tokens.color.ink,
  };

  const [threads, setThreads] = useState<MessageThreadRow[] | null>(null);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<MessageableTeacher[] | null>(null);

  const fetchThreads = useCallback(() => {
    setThreadsError(null);
    return api
      .request<MessageThreadRow[]>('/me/messages')
      .then((data) => setThreads(data))
      .catch((e: unknown) => setThreadsError(e instanceof ApiError ? e.message : 'Something went wrong.'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void fetchThreads();
      api
        .request<MessageableTeacher[]>('/me/messages/teachers')
        .then((data) => {
          if (!cancelled) setTeachers(data);
        })
        .catch(() => {
          // The ask-a-teacher picker is a secondary affordance; a failure to
          // load the pickable set must not blank the thread list. It simply
          // stays unavailable until the next focus.
          if (!cancelled) setTeachers([]);
        });
      return () => {
        cancelled = true;
      };
    }, [fetchThreads]),
  );

  // ── Ask a teacher ─────────────────────────────────────────────────────────
  const [asking, setAsking] = useState(false);
  const [picked, setPicked] = useState<MessageableTeacher | null>(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  function resetAsk() {
    setAsking(false);
    setPicked(null);
    setBody('');
    setSendError(null);
  }

  const trimmed = body.trim();
  const canSend = !!picked && trimmed.length > 0 && trimmed.length <= MESSAGE_BODY_MAX && !sending;

  async function send() {
    if (!picked || !canSend) return;
    setSending(true);
    setSendError(null);
    try {
      const detail = await api.request<MessageThreadDetail>('/me/messages', {
        method: 'POST',
        body: { teacherId: picked.teacherId, subjectId: picked.subjectId, body: trimmed },
      });
      resetAsk();
      await fetchThreads();
      router.push(`/(family)/messages/${detail.thread.id}`);
    } catch (e) {
      setSendError(e instanceof ApiError ? e.message : 'Could not send — try again.');
    } finally {
      setSending(false);
    }
  }

  const sorted = (threads ?? [])
    .slice()
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

  return (
    <Screen>
      <SectionTitle title="Messages" />

      {!asking && (
        <Pressable
          testID="ask-teacher"
          onPress={() => setAsking(true)}
          style={{ backgroundColor: tokens.color.indigo, borderRadius: 14, padding: 15 }}
        >
          <Text style={{ color: tokens.color.onBrand, fontWeight: '700', textAlign: 'center' }}>
            Ask a teacher
          </Text>
        </Pressable>
      )}

      {asking && (
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: tokens.color.sub }}>
              {picked ? 'New message' : 'Pick a teacher and subject'}
            </Text>
            <Pressable testID="ask-cancel" onPress={resetAsk}>
              <Text style={{ color: tokens.color.sub, fontWeight: '700', fontSize: 12 }}>Cancel</Text>
            </Pressable>
          </View>

          {!picked && teachers === null && (
            <Text style={{ color: tokens.color.sub, fontSize: 12.5 }}>Loading your teachers…</Text>
          )}
          {!picked && teachers?.length === 0 && (
            <Text testID="no-teachers" style={{ color: tokens.color.sub, fontSize: 12.5 }}>
              You have no subject teachers assigned this week yet.
            </Text>
          )}
          {!picked &&
            teachers?.map((t) => (
              <Pressable
                key={`${t.teacherId}-${t.subjectId}`}
                testID={`teacher-option-${t.teacherId}-${t.subjectId}`}
                onPress={() => setPicked(t)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderWidth: 1,
                  borderColor: tokens.color.line,
                  backgroundColor: tokens.color.surface,
                  borderRadius: 11,
                  padding: 11,
                }}
              >
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>{t.teacherName}</Text>
                  <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>{t.subjectName}</Text>
                </View>
                <Text style={{ color: tokens.color.sub, fontSize: 16 }}>›</Text>
              </Pressable>
            ))}

          {picked && (
            <>
              {/* Chosen teacher — the picker list is collapsed so the composer
                  sits right here. No scrolling past every other teacher to
                  reach the box (the reported bug). "Change" reopens the list. */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: tokens.color.indigo50,
                  borderRadius: 11,
                  padding: 11,
                }}
              >
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>
                    {picked.teacherName}
                  </Text>
                  <Text style={{ fontSize: 11.5, color: tokens.color.indigo, marginTop: 2 }}>
                    {picked.subjectName}
                  </Text>
                </View>
                <Pressable testID="change-teacher" onPress={() => setPicked(null)} hitSlop={8}>
                  <Text style={{ color: tokens.color.indigo, fontWeight: '700', fontSize: 12 }}>Change</Text>
                </Pressable>
              </View>

              <TextInput
                testID="compose-body"
                value={body}
                onChangeText={setBody}
                placeholder={`Ask ${picked.teacherName} about ${picked.subjectName}…`}
                placeholderTextColor={tokens.color.sub}
                multiline
                autoFocus
                maxLength={MESSAGE_BODY_MAX}
                style={[inputStyle, { minHeight: 84, textAlignVertical: 'top' }]}
              />
              {sendError && (
                <Text testID="send-error" style={{ color: tokens.color.red, fontSize: 12.5 }}>
                  {sendError}
                </Text>
              )}
              <Pressable
                testID="compose-send"
                onPress={() => void send()}
                disabled={!canSend}
                style={{
                  backgroundColor: tokens.color.indigo,
                  borderRadius: 14,
                  padding: 14,
                  opacity: canSend ? 1 : 0.6,
                }}
              >
                <Text style={{ color: tokens.color.onBrand, fontWeight: '700', textAlign: 'center' }}>
                  {sending ? 'Sending…' : 'Send'}
                </Text>
              </Pressable>
            </>
          )}
        </Card>
      )}

      <SectionTitle title="Your conversations" />

      {threadsError && (
        <Card>
          <Text testID="threads-error" style={{ color: tokens.color.red }}>
            {threadsError}
          </Text>
        </Card>
      )}
      {threads === null && !threadsError && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading messages…</Text>
        </Card>
      )}
      {threads?.length === 0 && !threadsError && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>
            No messages yet. Tap “Ask a teacher” to start a conversation.
          </Text>
        </Card>
      )}
      {sorted.map((t) => (
        <Pressable
          key={t.id}
          testID={`thread-${t.id}`}
          onPress={() => router.push(`/(family)/messages/${t.id}`)}
        >
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>{t.teacherName}</Text>
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
