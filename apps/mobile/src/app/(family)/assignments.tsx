import { useCallback, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import type { StudentAssignment, StudentAssignmentList } from '@/lib/portal';
import { Card, Empty, Page, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/** `StudentAssignment.dueDate` (`@db.Date`, `YYYY-MM-DD`) — a plain calendar date, no time component. */
function formatDueDate(dueDate: string): string {
  const [y, m, d] = dueDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * One assignment row, expandable to its instructions and attachments.
 *
 * NO TICK, NO CHECKBOX, NO STRIKE-THROUGH. The repaint drew a past-due row as
 * a ticked, struck-out checklist line — and `GET /me/assignments` carries NO
 * submission state at all. It splits `upcoming`/`past` purely on the due date,
 * so a green tick against a piece of homework says "handed in" about something
 * the app cannot know. `past` gets the section heading it already had, and the
 * dimming, and nothing that reads as a receipt.
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
        opacity: done ? 0.7 : 1,
      }}
    >
      <Pressable
        testID={`assignment-toggle-${a.id}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        onPress={onToggle}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12 }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>{a.title}</Text>
          <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>
            {a.subjectName} · due {formatDueDate(a.dueDate)}
          </Text>
        </View>

        <Text style={{ fontSize: 13, color: tokens.color.sub }}>{isOpen ? '▲' : '▼'}</Text>
      </Pressable>

      {isOpen && (
        <View
          style={{
            paddingHorizontal: 12,
            paddingBottom: 12,
            paddingTop: 2,
            // The 30dp indent existed to clear the checkbox that used to lead
            // the row; with no checkbox it just left the instructions hanging.
            marginLeft: 12,
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
        <LoadingRows label="Loading assignments…" rows={4} />
      )}
      {list !== null && !error && upcoming.length === 0 && past.length === 0 && (
        <Card style={{ padding: 0 }}>
          <Empty icon="assignments">No assignments yet.</Empty>
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
