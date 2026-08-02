import { useCallback, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  MESSAGE_BODY_MAX,
  type MessageRow,
  type MessageThreadDetail,
} from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { Card, Empty, Page } from '@/components/ui';
import { DUR, useGesture } from '@/theme/motion';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * The pitch's `bubin`: a bubble fades up into the transcript rather than
 * blinking into it.
 *
 * WHY it is a rise and not THE PIN: a pinned thing is put ON the page from
 * outside (a notice, a diary line), and it lands askew because a hand put it
 * there. A message is written INTO the conversation and pushes the transcript
 * up as it arrives, so it rises the last few pixels into place and stays
 * square. Same six-gesture rule underneath — it runs through `useGesture`, so
 * reduce-motion snaps it straight to the finished state and no meaning is
 * carried by the movement.
 */
function useBubbleIn() {
  const v = useGesture(true, DUR.screen);
  return {
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
  };
}

function Bubble({ m, mine, senderLabel }: { m: MessageRow; mine: boolean; senderLabel: string }) {
  const tokens = useTokens();
  const arrival = useBubbleIn();
  return (
    <Animated.View
      testID={`message-${m.id}`}
      style={[
        {
          alignSelf: mine ? 'flex-end' : 'flex-start',
          maxWidth: '80%',
          backgroundColor: mine ? tokens.color.indigo : tokens.color.surface,
          borderColor: tokens.color.line,
          borderWidth: mine ? 0 : 1,
          // The pitch's asymmetric tail: the corner nearest the speaker is
          // clipped to 5, which is what makes a stack of bubbles read as two
          // people talking rather than as a list of boxes.
          borderRadius: 13,
          borderBottomRightRadius: mine ? 5 : 13,
          borderBottomLeftRadius: mine ? 13 : 5,
          paddingVertical: 8,
          paddingHorizontal: 11,
        },
        arrival,
      ]}
    >
      <Text style={{ fontSize: 9.5, fontWeight: '700', color: mine ? tokens.color.onBrand : tokens.color.sub }}>
        {senderLabel}
      </Text>
      <Text
        style={{
          fontSize: 12.5,
          lineHeight: 17,
          color: mine ? tokens.color.onBrand : tokens.color.ink,
          marginTop: 3,
        }}
      >
        {m.body}
      </Text>
      <Text
        style={{
          fontFamily: font.mono,
          fontSize: 9,
          color: mine ? tokens.color.onBrand : tokens.color.sub,
          opacity: mine ? 0.85 : 1,
          marginTop: 4,
        }}
      >
        {formatWhen(m.createdAt)}
      </Text>
    </Animated.View>
  );
}

/**
 * A single conversation with one of the student's own subject teachers.
 * Messages render chronological (ascending); the view scrolls to the end on
 * open so the latest reply is visible without scrolling — the "response at the
 * top" requirement is served at the list level (newest thread first), and
 * within a thread the newest message sits right above the composer, chat-style.
 *
 * Repainted to the pitch's `.chat`: bubbles on the paper background (theirs
 * white with a pencil rule, yours indigo), and a pill `.composer` docked at
 * the bottom.
 *
 * Role-neutral copy: the student's own messages read "You", the other side
 * reads with the teacher's name — never a parent-assuming label.
 */
export default function StudentThread() {
  const tokens = useTokens();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();

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
        contentContainerStyle={{ padding: 14, gap: 7, paddingBottom: 20 }}
      >
        {detail && (
          // `.gatehead` — whose page this is, in the diary's own voice.
          <View style={{ marginBottom: 4 }}>
            <Text style={{ fontFamily: font.serif, fontSize: 18, color: tokens.color.ink }}>
              {detail.thread.teacherName}
            </Text>
            <Text style={{ fontSize: 11, color: tokens.color.sub, marginTop: 1 }}>
              {detail.thread.subjectName}
            </Text>
          </View>
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
          <Page>
            <Empty>No messages in this conversation yet.</Empty>
          </Page>
        )}

        {detail?.messages.map((m: MessageRow) => {
          const mine = m.senderRole === 'STUDENT';
          return (
            <Bubble key={m.id} m={m} mine={mine} senderLabel={mine ? 'You' : detail.thread.teacherName} />
          );
        })}
      </ScrollView>

      {detail && (
        // `.composer` — one pill: the line you write on and the button that
        // sends it, docked so the transcript scrolls behind it.
        <View style={{ paddingHorizontal: 10, paddingTop: 4, paddingBottom: 10 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: 7,
              backgroundColor: tokens.color.surface,
              borderWidth: 1,
              borderColor: tokens.color.line,
              borderRadius: tokens.radius.chip,
              paddingLeft: 13,
              paddingRight: 5,
              paddingVertical: 5,
              shadowColor: tokens.color.ink,
              shadowOpacity: 0.05,
              shadowRadius: 34,
              shadowOffset: { width: 0, height: 14 },
              elevation: 2,
            }}
          >
            <TextInput
              testID="reply-body"
              value={body}
              onChangeText={setBody}
              placeholder="Write a message…"
              placeholderTextColor={tokens.color.placeholder}
              multiline
              maxLength={MESSAGE_BODY_MAX}
              style={{
                flex: 1,
                fontSize: 12.5,
                color: tokens.color.ink,
                maxHeight: 110,
                paddingVertical: 6,
              }}
            />
            <Pressable
              testID="reply-send"
              accessibilityRole="button"
              accessibilityLabel="Send"
              onPress={() => void send()}
              disabled={!canSend}
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: tokens.color.indigo,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: canSend ? 1 : 0.6,
              }}
            >
              <Text style={{ color: tokens.color.onBrand, fontSize: 13, fontWeight: '700' }}>
                {sending ? '…' : '➤'}
              </Text>
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
