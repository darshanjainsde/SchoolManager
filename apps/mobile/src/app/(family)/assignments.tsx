import { useCallback, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import type { StudentAssignment, StudentAssignmentList } from '@/lib/portal';
import { Card, Page, Screen, SectionTitle, Tick } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/** `StudentAssignment.dueDate` (`@db.Date`, `YYYY-MM-DD`) — a plain calendar date, no time component. */
function formatDueDate(dueDate: string): string {
  const [y, m, d] = dueDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * One `.todo` row — homework as a line on a checklist.
 *
 * THE TICK is the gesture, and it is the only one that fits: a checkbox glyph
 * that is simply *there* states a fact, while a tick that STROKES ITSELF ON
 * (SVG path, `strokeDashoffset` running down to zero) is the mark somebody
 * made. That difference is the whole reason the six gestures name it — see
 * `Tick` in `components/ui.tsx`, which owns the stroke and its `native: false`
 * (a dash offset is not a transform, so it can never run on the UI thread).
 *
 * WHAT the tick claims, precisely: the DUE DATE HAS PASSED — this row is off
 * the list of things still to do. `GET /me/assignments` splits upcoming/past
 * and carries no submission state, so the app has no idea whether the work was
 * actually handed in and must not imply that it does. Hence the row goes .55
 * and the title is struck through when it is in the `past` bucket, and never
 * as a result of anything the reader taps.
 */
function TodoRow({
  a,
  done,
  isOpen,
  onToggle,
  first,
}: {
  a: StudentAssignment;
  done: boolean;
  isOpen: boolean;
  onToggle: () => void;
  first: boolean;
}) {
  const tokens = useTokens();
  return (
    <View
      testID={`assignment-${a.id}`}
      style={{
        borderTopWidth: first ? 0 : 1,
        borderTopColor: tokens.color.line,
        opacity: done ? 0.55 : 1,
      }}
    >
      <Pressable
        testID={`assignment-toggle-${a.id}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        onPress={onToggle}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12 }}
      >
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 7,
            borderWidth: 1.5,
            borderColor: done ? tokens.color.green : tokens.color.line2,
            backgroundColor: done ? tokens.color.green50 : tokens.color.appBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {done && <Tick size={12} />}
        </View>

        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 12.5,
              fontWeight: '600',
              color: done ? tokens.color.sub : tokens.color.ink,
              textDecorationLine: done ? 'line-through' : 'none',
            }}
          >
            {a.title}
          </Text>
          <Text style={{ fontSize: 9.5, color: tokens.color.sub, marginTop: 1 }}>
            {a.subjectName} · due {formatDueDate(a.dueDate)}
          </Text>
        </View>

        <Text style={{ fontSize: 12, color: tokens.color.sub }}>{isOpen ? '▲' : '▼'}</Text>
      </Pressable>

      {isOpen && (
        <View
          style={{
            paddingHorizontal: 12,
            paddingBottom: 12,
            paddingTop: 2,
            marginLeft: 30,
            borderLeftWidth: 1.5,
            borderLeftColor: tokens.color.line,
          }}
        >
          <Text style={{ fontSize: 12.5, color: tokens.color.ink2, lineHeight: 18, paddingLeft: 10 }}>
            {a.instructions}
          </Text>
          {a.attachments.length > 0 && (
            <View style={{ marginTop: 8, gap: 6, paddingLeft: 10 }}>
              {a.attachments.map((att) => (
                <Pressable key={att.url} testID={`attachment-${att.name}`} onPress={() => void Linking.openURL(att.url)}>
                  <Text style={{ fontFamily: font.mono, fontSize: 11.5, fontWeight: '700', color: tokens.color.indigo }}>
                    📎 {att.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Homework for the student's own class — mirrors the web's
 * `/portal/assignments` (apps/web/app/portal/assignments/page.tsx).
 * `GET /me/assignments` already splits upcoming/past (today counts as
 * upcoming); this screen just renders whichever bucket a row is in.
 */
export default function Assignments() {
  const tokens = useTokens();
  const [list, setList] = useState<StudentAssignmentList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      api
        .request<StudentAssignmentList>('/me/assignments')
        .then((data) => {
          if (!cancelled) setList(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  // `POST /me/assignments/:id/seen` is idempotent server-side, but this ref
  // still stops a second call within the same visit — opening, closing and
  // re-opening a card fires the request once, not once per toggle.
  const seenSentRef = useRef<Set<string>>(new Set());

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        if (!seenSentRef.current.has(id)) {
          seenSentRef.current.add(id);
          void api.request(`/me/assignments/${id}/seen`, { method: 'POST' }).catch(() => undefined);
        }
      }
      return next;
    });
  }

  const upcoming = list?.upcoming ?? [];
  const past = list?.past ?? [];

  return (
    <Screen>
      <SectionTitle title="Assignments" />
      {error && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{error}</Text>
        </Card>
      )}
      {list === null && !error && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading assignments…</Text>
        </Card>
      )}
      {list !== null && !error && upcoming.length === 0 && past.length === 0 && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>No assignments yet.</Text>
        </Card>
      )}
      {upcoming.length > 0 && (
        <>
          <SectionTitle title="Upcoming" />
          <Page>
            {upcoming.map((a, i) => (
              <TodoRow
                key={a.id}
                a={a}
                done={false}
                first={i === 0}
                isOpen={openIds.has(a.id)}
                onToggle={() => toggle(a.id)}
              />
            ))}
          </Page>
        </>
      )}
      {past.length > 0 && (
        <>
          <SectionTitle title="Past" />
          <Page>
            {past.map((a, i) => (
              <TodoRow
                key={a.id}
                a={a}
                done
                first={i === 0}
                isOpen={openIds.has(a.id)}
                onToggle={() => toggle(a.id)}
              />
            ))}
          </Page>
        </>
      )}
    </Screen>
  );
}
