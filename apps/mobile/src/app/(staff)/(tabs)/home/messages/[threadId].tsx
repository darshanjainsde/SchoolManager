import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  MESSAGE_BODY_MAX,
  type MessageRow,
  type MessageThreadDetail,
} from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { Card, Empty } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';
import { DUR, useGesture } from '@/theme/motion';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * The pitch's `.bub`/`bubin` — a message fades in and RISES a few pixels into
 * place. Deliberately NOT one of the six paper gestures: a chat bubble is the
 * one surface in this app that is not paper, and dropping it from above with
 * THE PIN (or thumping it down with THE STAMP) would say "a note was filed"
 * when what happened is "someone spoke". It rises because a reply comes up
 * out of the composer, which is where the teacher's attention already is.
 * Fires once per message, on the render it first appears in, so the history
 * does not re-animate every time the thread refetches.
 */
function Bubble({ index, mine, children }: { index: number; mine: boolean; children: ReactNode }) {
  const arrive = useGesture(true, DUR.screen, { delay: Math.min(index, 8) * 35 });
  return (
    <Animated.View
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '86%',
        opacity: arrive,
        transform: [{ translateY: arrive.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

/**
 * A student's question thread, teacher side. `POST /manage/messages/:threadId`
 * asserts the stored thread's teacherId equals the caller — the teacherId is
 * never taken from client input — so a teacher can only ever reply within
 * their own threads. Messages render chronological; the view scrolls to the
 * newest on open so the latest question is visible without scrolling.
 */
export default function StaffThread() {
  const tokens = useTokens();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  // `.composer input` — bare inside the pill, since the pill itself is the
  // field; a box drawn inside a box reads as two controls.
  const inputStyle = {
    paddingHorizontal: 13,
    paddingVertical: 9,
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
      .request<MessageThreadDetail>(`/manage/messages/${threadId}`)
      .then((data) => {
        setDetail(data);
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
    if (!detail || !canSend || !threadId) return;
    setSending(true);
    setSendError(null);
    try {
      const next = await api.request<MessageThreadDetail>(`/manage/messages/${threadId}`, {
        method: 'POST',
        body: { body: trimmed },
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
            <Text style={{ fontFamily: font.serif, fontSize: 17, fontWeight: '700', color: tokens.color.ink }}>
              {detail.thread.studentName}
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
          <LoadingRows label="Loading conversation…" rows={4} />
        )}
        {detail?.messages.length === 0 && !error && (
          <Card style={{ padding: 0 }}>
            <Empty icon="messages">No messages in this conversation yet.</Empty>
          </Card>
        )}

        {detail?.messages.map((m: MessageRow, i: number) => {
          const mine = m.senderRole === 'TEACHER';
          return (
            <Bubble key={m.id} index={i} mine={mine}>
            {/* `.bub` — the tail corner is squared off on the side the message
                came from, which is what makes a column of bubbles readable as
                a conversation rather than a stack of cards. */}
            <View
              testID={`message-${m.id}`}
              style={{
                backgroundColor: mine ? tokens.color.indigo : tokens.color.surface,
                borderColor: tokens.color.line,
                borderWidth: mine ? 0 : 1,
                borderRadius: 13,
                borderBottomRightRadius: mine ? 5 : 13,
                borderBottomLeftRadius: mine ? 13 : 5,
                padding: 11,
              }}
            >
              <Text style={{ fontSize: 10.5, fontWeight: '700', color: mine ? tokens.color.onBrand : tokens.color.sub }}>
                {mine ? 'You' : detail.thread.studentName}
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
            </Bubble>
          );
        })}
      </ScrollView>

      {/* `.composer` — one pill floating over the page, not a docked toolbar:
          replying is a small act, and the control should look like one. */}
      {detail && (
        <View style={{ padding: 12 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: 7,
              paddingLeft: 3,
              paddingRight: 4,
              paddingVertical: 4,
              borderWidth: 1,
              borderColor: tokens.color.line,
              borderRadius: 999,
              backgroundColor: tokens.color.surface,
            }}
          >
            <TextInput
              testID="reply-body"
              value={body}
              onChangeText={setBody}
              placeholder="Write a reply…"
              placeholderTextColor={tokens.color.placeholder}
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
                borderRadius: 999,
                minWidth: 34,
                height: 34,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 12,
                opacity: canSend ? 1 : 0.6,
              }}
            >
              <Text style={{ color: tokens.color.onBrand, fontWeight: '700' }}>{sending ? '…' : 'Send'}</Text>
            </Pressable>
          </View>
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
