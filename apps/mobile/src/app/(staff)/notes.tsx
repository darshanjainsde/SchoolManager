import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { NoteClass } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { Card, Pill, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/**
 * Notes & To-dos — the per-class history tab. The live "Today" panel
 * (ClassNotesPanel) only ever shows one class+subject for the current lesson,
 * so a note written on Monday feels lost by Tuesday. This screen lists every
 * (section, subject) the teacher keeps notes for and opens each one's full
 * history, where they can also add more on any day.
 *
 * `GET /manage/note-classes` returns one row per (classSection, subject) the
 * caller teaches on their own timetable — server-enforced — with running
 * note/open-to-do counts so the list is scannable at a glance.
 */
export default function Notes() {
  const tokens = useTokens();
  const [classes, setClasses] = useState<NoteClass[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      api
        .request<NoteClass[]>('/manage/note-classes')
        .then((data) => {
          if (!cancelled) setClasses(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const open = (c: NoteClass) => {
    router.push(
      `/(staff)/notes/${encodeURIComponent(c.classSectionId)}?subjectId=${encodeURIComponent(c.subjectId)}&className=${encodeURIComponent(c.className)}&subjectName=${encodeURIComponent(c.subjectName)}`,
    );
  };

  return (
    <Screen>
      <SectionTitle title="Notes & to-dos" />
      <Text style={{ fontSize: 11, color: tokens.color.sub, marginHorizontal: 4, marginTop: -6 }}>
        Every class you teach and its full notes history — pick up where you left off, or add more any
        time.
      </Text>

      {error && (
        <Card>
          <Text testID="note-classes-error" style={{ color: tokens.color.red }}>
            {error}
          </Text>
        </Card>
      )}
      {classes === null && !error && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading your classes…</Text>
        </Card>
      )}
      {classes?.length === 0 && !error && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>
            You have no classes to keep notes for yet.
          </Text>
        </Card>
      )}

      {(classes ?? []).map((c) => (
        <Pressable
          key={`${c.classSectionId}:${c.subjectId}`}
          testID={`note-class-${c.classSectionId}-${c.subjectId}`}
          onPress={() => open(c)}
        >
          {/* `.clsrow` — the same 34px serif-initial tile the attendance
              class list uses, so a class is the same object on both screens. */}
          <Card style={{ gap: 7 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  backgroundColor: tokens.color.indigo,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    fontFamily: font.serif,
                    fontWeight: '700',
                    fontSize: 14,
                    color: tokens.color.onBrand,
                  }}
                >
                  {c.className.trim().charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text
                style={{
                  fontFamily: font.serif,
                  fontSize: 15,
                  fontWeight: '700',
                  color: tokens.color.ink,
                  flex: 1,
                }}
              >
                {`${c.className} · ${c.subjectName}`}
              </Text>
              <Pill tone={c.isClassTeacher ? 'indigo' : 'neutral'}>
                {c.isClassTeacher ? 'Class teacher' : 'Subject teacher'}
              </Pill>
            </View>
            {/* Counts in mono — figures that must line up row to row. */}
            <View style={{ flexDirection: 'row', gap: 14, marginLeft: 45 }}>
              <Text style={{ fontFamily: font.mono, fontSize: 11, color: tokens.color.sub }}>
                {`📌 ${c.noteCount} ${c.noteCount === 1 ? 'note' : 'notes'}`}
              </Text>
              <Text style={{ fontFamily: font.mono, fontSize: 11, color: tokens.color.sub }}>
                {`✓ ${c.openTodoCount} open ${c.openTodoCount === 1 ? 'to-do' : 'to-dos'}`}
              </Text>
            </View>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
