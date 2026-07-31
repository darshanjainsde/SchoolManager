import { useCallback, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import type { StudentAssignment, StudentAssignmentList } from '@/lib/portal';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';

/** `StudentAssignment.dueDate` (`@db.Date`, `YYYY-MM-DD`) — a plain calendar date, no time component. */
function formatDueDate(dueDate: string): string {
  const [y, m, d] = dueDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function AssignmentCard({
  a,
  isOpen,
  onToggle,
}: {
  a: StudentAssignment;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const tokens = useTokens();
  return (
    <Card testID={`assignment-${a.id}`}>
      <Pressable testID={`assignment-toggle-${a.id}`} onPress={onToggle}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>{a.title}</Text>
            <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>{a.subjectName}</Text>
            <Text style={{ fontSize: 11, color: tokens.color.sub, marginTop: 2 }}>Due {formatDueDate(a.dueDate)}</Text>
          </View>
          <Text style={{ fontSize: 14, color: tokens.color.sub }}>{isOpen ? '▲' : '▼'}</Text>
        </View>
      </Pressable>

      {isOpen && (
        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: tokens.color.line }}>
          <Text style={{ fontSize: 12.5, color: tokens.color.ink }}>{a.instructions}</Text>
          {a.attachments.length > 0 && (
            <View style={{ marginTop: 8, gap: 6 }}>
              {a.attachments.map((att) => (
                <Pressable
                  key={att.url}
                  testID={`attachment-${att.name}`}
                  onPress={() => void Linking.openURL(att.url)}
                >
                  <Text style={{ fontSize: 12.5, fontWeight: '700', color: tokens.color.indigo }}>📎 {att.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}
    </Card>
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
          {upcoming.map((a) => (
            <AssignmentCard key={a.id} a={a} isOpen={openIds.has(a.id)} onToggle={() => toggle(a.id)} />
          ))}
        </>
      )}
      {past.length > 0 && (
        <>
          <SectionTitle title="Past" />
          {past.map((a) => (
            <AssignmentCard key={a.id} a={a} isOpen={openIds.has(a.id)} onToggle={() => toggle(a.id)} />
          ))}
        </>
      )}
    </Screen>
  );
}
