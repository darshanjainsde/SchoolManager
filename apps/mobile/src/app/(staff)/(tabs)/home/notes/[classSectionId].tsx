import { useCallback, useState } from 'react';
import { Animated, Pressable, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { ClassLog, ClassLogNote, ClassLogTodo } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { shiftISO, todayISO } from '@/lib/attendance';
import { Card, ErrorState, Screen, SectionTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Chip, ChipRow } from '@/components/Chip';
import { fieldInputStyle } from '@/components/Field';
import { LoadingRows } from '@/components/Loading';
import { Icon } from '@/components/icons';
import { useTokens } from '@/theme/theme-context';
import { DASH, DUR, strokeDashoffset, useGesture } from '@/theme/motion';
import { fmtWeekdayDate } from '@/lib/dates';

const AnimatedPath = Animated.createAnimatedComponent(Path);

type Composer = 'note' | 'todo';

/**
 * THE TICK (`.todo .box` + `.tick`) — the one gesture that has to be earned.
 * A to-do closing is the smallest piece of finished work in this app, and a
 * tick that simply APPEARS reads as state; a tick that is STROKED reads as
 * something the teacher just did. The path is drawn by running its dash
 * offset from the path's length to zero — not a transform, hence
 * `native: false` (see motion.ts).
 */
function TickBox({ done, testID }: { done: boolean; testID?: string }) {
  const tokens = useTokens();
  const stroke = useGesture(done, DUR.tick, { native: false });
  return (
    <View
      testID={testID}
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
      {done && (
        <Svg width={13} height={13} viewBox="0 0 24 24">
          <AnimatedPath
            d="M4 12.5 L10 18 L20 6"
            stroke={tokens.color.green}
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={DASH.tick}
            strokeDashoffset={strokeDashoffset(stroke, DASH.tick)}
          />
        </Svg>
      )}
    </View>
  );
}

/** Human day heading — Today / Yesterday / a readable date. */
function dayLabel(date: string): string {
  const today = todayISO();
  if (date === today) return 'Today';
  if (date === shiftISO(today, -1)) return 'Yesterday';
  return fmtWeekdayDate(date);
}

interface DaySection {
  date: string;
  notes: ClassLogNote[];
  todos: ClassLogTodo[];
}

/**
 * Groups the flat notes/to-dos lists into day sections, newest day first.
 * Both lists arrive newest-day-first from the server; we take the union of
 * their dates (a day can hold only notes, only to-dos, or both) and keep that
 * ordering so a day with just a to-do still gets its own heading.
 */
function groupByDay(notes: ClassLogNote[], todos: ClassLogTodo[]): DaySection[] {
  const dates: string[] = [];
  const seen = new Set<string>();
  for (const row of [...notes, ...todos]) {
    if (!seen.has(row.date)) {
      seen.add(row.date);
      dates.push(row.date);
    }
  }
  dates.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return dates.map((date) => ({
    date,
    notes: notes.filter((n) => n.date === date),
    todos: todos.filter((t) => t.date === date),
  }));
}

/**
 * One class+subject's full notes/to-dos history. Reads the same
 * `/manage/class-notes` (POST) and `/manage/class-todos` (POST/PATCH)
 * contracts the live ClassNotesPanel uses; the difference is scope — this
 * screen loads every date via `/manage/class-log` and lets the teacher add on
 * *today* from a composer pinned at the bottom.
 */
export default function ClassNotesHistory() {
  const tokens = useTokens();
  const { classSectionId, subjectId, className, subjectName } = useLocalSearchParams<{
    classSectionId: string;
    subjectId: string;
    className: string;
    subjectName: string;
  }>();

  const [log, setLog] = useState<ClassLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Composer>('note');
  const [body, setBody] = useState('');
  const [bodyFocused, setBodyFocused] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    if (!classSectionId || !subjectId) return Promise.resolve();
    setError(null);
    return api
      .request<ClassLog>(
        `/manage/class-log?classSectionId=${encodeURIComponent(classSectionId)}&subjectId=${encodeURIComponent(subjectId)}`,
      )
      .then((data) => setLog(data))
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? e.message : 'Something went wrong.');
      });
  }, [classSectionId, subjectId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function add() {
    const trimmed = body.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    setError(null);
    const path = mode === 'note' ? '/manage/class-notes' : '/manage/class-todos';
    try {
      await api.request(path, {
        method: 'POST',
        body: { classSectionId, subjectId, date: todayISO(), body: trimmed },
      });
      setBody('');
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : `Could not add the ${mode === 'note' ? 'note' : 'to-do'}.`,
      );
    } finally {
      setAdding(false);
    }
  }

  async function toggleTodo(id: string, done: boolean) {
    try {
      await api.request(`/manage/class-todos/${id}`, { method: 'PATCH', body: { done } });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update the to-do.');
    }
  }

  const heading = className && subjectName ? `${className} · ${subjectName}` : 'Notes & to-dos';
  const sections = log ? groupByDay(log.notes, log.todos) : [];
  const empty = log !== null && sections.length === 0;

  return (
    <Screen>
      <SectionTitle title={heading} />

      {error && log === null && <ErrorState testID="class-log-error" error={error} onRetry={() => void load()} />}
      {error && log !== null && (
        <Card>
          <Text testID="class-log-error" style={{ color: tokens.color.red }}>
            {error}
          </Text>
        </Card>
      )}
      {log === null && !error && (
        <LoadingRows label="Loading notes…" rows={3} />
      )}
      {empty && !error && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>
            Nothing here yet — add your first note or to-do below.
          </Text>
        </Card>
      )}

      {sections.map((s) => (
        <Card key={s.date} testID={`day-${s.date}`} style={{ gap: 4 }}>
          {/* A day heading — a page in a book of days, not a filter label. */}
          <Text
            style={{
              fontSize: 17,
              fontWeight: '700',
              color: tokens.color.ink,
              marginBottom: 3,
            }}
          >
            {dayLabel(s.date)}
          </Text>
          {s.notes.map((n) => (
            <View
              key={n.id}
              testID={`note-${n.id}`}
              style={{ flexDirection: 'row', gap: 8, paddingVertical: 6 }}
            >
              <Icon name="pin" size={16} color={tokens.color.sub} />
              <Text style={{ fontSize: 14, lineHeight: 20, color: tokens.color.ink, flex: 1 }}>{n.body}</Text>
            </View>
          ))}
          {s.todos.map((t) => (
            <Pressable
              key={t.id}
              testID={`todo-toggle-${t.id}`}
              onPress={() => void toggleTodo(t.id, !t.done)}
              // `.todo` — a full-width row with the box leading it, the way a
              // ruled list is ticked down the left margin.
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                minHeight: 56,
                paddingVertical: 8,
                paddingHorizontal: 16,
                marginHorizontal: -16,
                borderTopWidth: 1,
                borderTopColor: tokens.color.line,
                opacity: pressed ? 0.8 : 1,
              })}
              accessibilityRole="button"
              >
              <TickBox done={t.done} testID={`todo-box-${t.id}`} />
              <Text
                style={{
                  fontSize: 14,
                  lineHeight: 20,
                  color: t.done ? tokens.color.sub : tokens.color.ink,
                  textDecorationLine: t.done ? 'line-through' : 'none',
                  flex: 1,
                }}
              >
                {t.body}
              </Text>
            </Pressable>
          ))}
        </Card>
      ))}

      {/* Composer — add a note or to-do on today. */}
      <Card style={{ gap: 12 }}>
        <ChipRow>
          <Chip testID="composer-mode-note" label="Note" selected={mode === 'note'} onPress={() => setMode('note')} />
          <Chip testID="composer-mode-todo" label="To-do" selected={mode === 'todo'} onPress={() => setMode('todo')} />
        </ChipRow>

        <Text style={{ fontSize: 13, lineHeight: 18, color: tokens.color.sub }}>
          {mode === 'note'
            ? 'A note records something worth remembering about this class.'
            : 'A to-do is a task you can tick off once it’s done.'}
        </Text>

        {mode === 'note' ? (
          <TextInput
            testID="composer-input"
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={1000}
            placeholder={`Write a note for ${className || 'this class'}…`}
            placeholderTextColor={tokens.color.placeholder}
            onFocus={() => setBodyFocused(true)}
            onBlur={() => setBodyFocused(false)}
            style={fieldInputStyle(tokens, { focused: bodyFocused, multiline: true })}
          />
        ) : (
          <TextInput
            testID="composer-input"
            value={body}
            onChangeText={setBody}
            maxLength={1000}
            placeholder="Add a task…"
            placeholderTextColor={tokens.color.placeholder}
            onFocus={() => setBodyFocused(true)}
            onBlur={() => setBodyFocused(false)}
            style={fieldInputStyle(tokens, { focused: bodyFocused })}
          />
        )}

        <Button
          testID="composer-add"
          block
          busy={adding}
          disabled={adding || body.trim().length === 0}
          label={adding ? 'Adding…' : mode === 'note' ? 'Add note' : 'Add to-do'}
          onPress={() => void add()}
        />
      </Card>
    </Screen>
  );
}
