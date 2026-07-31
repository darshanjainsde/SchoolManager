import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  MESSAGE_BODY_MAX,
  type MessageRow,
  type MessageThreadDetail,
} from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { Card } from '@/components/ui';
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
 * A single conversation with one of the student's own subject teachers.
 * Messages render chronological (ascending); the view scrolls to the end on
 * open so the latest reply is visible without scrolling — the "response at the
 * top" requirement is served at the list level (newest thread first), and
 * within a thread the newest message sits right above the composer, chat-style.
 *
 * Role-neutral copy: the student's own messages read "You", the other side
 * reads with the teacher's name — never a parent-assuming label.
 */
export default function StudentThread() {
  const tokens = useTokens();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const inputStyle = {
    borderWidth: 1,
    borderColor: tokens.color.line,
    borderRadius: 11,
    padding: 11,
    fontSize: 13.5,
    color: tokens.color.ink,
    flex: 1,
  };

  const [detail, setDetail] = useState<MessageThreadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(() => {
    if (!threadId) return Promise.resolve();
    setError(null);
    return api
      .request<MessageThreadDetail>(`/me/messages/${threadId}`)
      .then((data) => {
        setDetail(data);
        // Latest reply visible on open — jump to the end once the transcript
        // has laid out.
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd?.({ animated: false }));
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Something went wrong.'));
  }, [threadId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const trimmed = body.trim();
  const canSend = !!detail && trimmed.length > 0 && trimmed.length <= MESSAGE_BODY_MAX && !sending;

  async function send() {
    if (!detail || !canSend) return;
    setSending(true);
    setSendError(null);
    try {
      const next = await api.request<MessageThreadDetail>('/me/messages', {
        method: 'POST',
        body: {
          teacherId: detail.thread.teacherId,
          subjectId: detail.thread.subjectId,
          body: trimmed,
        },
      });
      setDetail(next);
      setBody('');
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd?.({ animated: true }));
    } catch (e) {
      setSendError(e instanceof ApiError ? e.message : 'Could not send — try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.appBg }}>
      <ScrollView
        ref={scrollRef}
        testID="thread-scroll"
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, gap: tokens.gap, paddingBottom: 20 }}
      >
        {detail && (
          <Card>
            <Text style={{ fontSize: 15, fontWeight: '800', color: tokens.color.ink }}>
              {detail.thread.teacherName}
            </Text>
            <Text style={{ fontSize: 12, color: tokens.color.indigo, marginTop: 2 }}>
              {detail.thread.subjectName}
            </Text>
          </Card>
        )}

        {error && (
          <Card>
            <Text testID="thread-error" style={{ color: tokens.color.red }}>
              {error}
            </Text>
          </Card>
        )}
        {detail === null && !error && (
          <Card>
            <Text style={{ color: tokens.color.sub }}>Loading conversation…</Text>
          </Card>
        )}
        {detail?.messages.length === 0 && !error && (
          <Card>
            <Text style={{ color: tokens.color.sub }}>No messages in this conversation yet.</Text>
          </Card>
        )}

        {detail?.messages.map((m: MessageRow) => {
          const mine = m.senderRole === 'STUDENT';
          return (
            <View
              key={m.id}
              testID={`message-${m.id}`}
              style={{
                alignSelf: mine ? 'flex-end' : 'flex-start',
                maxWidth: '86%',
                backgroundColor: mine ? tokens.color.indigo : tokens.color.surface,
                borderColor: tokens.color.line,
                borderWidth: mine ? 0 : 1,
                borderRadius: 14,
                padding: 11,
              }}
            >
              <Text style={{ fontSize: 10.5, fontWeight: '700', color: mine ? tokens.color.onBrand : tokens.color.sub }}>
                {mine ? 'You' : detail.thread.teacherName}
              </Text>
              <Text style={{ fontSize: 13.5, color: mine ? tokens.color.onBrand : tokens.color.ink, marginTop: 3 }}>
                {m.body}
              </Text>
              <Text
                style={{
                  fontSize: 10,
                  color: mine ? tokens.color.onBrand : tokens.color.sub,
                  opacity: mine ? 0.85 : 1,
                  marginTop: 4,
                }}
              >
                {formatWhen(m.createdAt)}
              </Text>
            </View>
          );
        })}
      </ScrollView>

      {detail && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 8,
            padding: 12,
            borderTopWidth: 1,
            borderTopColor: tokens.color.line,
            backgroundColor: tokens.color.surface,
          }}
        >
          <TextInput
            testID="reply-body"
            value={body}
            onChangeText={setBody}
            placeholder="Write a message…"
            placeholderTextColor={tokens.color.sub}
            multiline
            maxLength={MESSAGE_BODY_MAX}
            style={[inputStyle, { maxHeight: 110 }]}
          />
          <Pressable
            testID="reply-send"
            onPress={() => void send()}
            disabled={!canSend}
            style={{
              backgroundColor: tokens.color.indigo,
              borderRadius: 12,
              paddingHorizontal: 16,
              paddingVertical: 12,
              opacity: canSend ? 1 : 0.6,
            }}
          >
            <Text style={{ color: tokens.color.onBrand, fontWeight: '700' }}>{sending ? '…' : 'Send'}</Text>
          </Pressable>
        </View>
      )}
      {sendError && (
        <Text testID="reply-error" style={{ color: tokens.color.red, fontSize: 12.5, paddingHorizontal: 14, paddingBottom: 8 }}>
          {sendError}
        </Text>
      )}
    </View>
  );
}
