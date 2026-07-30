import { Pressable, Text, View } from 'react-native';
import type { TeacherDayEntry } from '@skoolos/types';
import { Card, Pill } from './ui';
import { tokens } from '@/theme/tokens';

export interface DayTimelineProps {
  entries: TeacherDayEntry[];
  /** Index of the current entry, or -1. Rows before it render dimmed. */
  currentIndex: number;
  onTakeAttendance: (classSectionId: string) => void;
}

function Row({
  entry,
  dimmed,
  onTakeAttendance,
}: {
  entry: TeacherDayEntry;
  dimmed: boolean;
  onTakeAttendance: (classSectionId: string) => void;
}) {
  return (
    <View
      testID={`timeline-row-${entry.periodId}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: tokens.color.line,
        opacity: dimmed ? 0.5 : 1,
      }}
    >
      <Text style={{ fontSize: 11.5, color: tokens.color.sub, width: 92 }}>
        {`${entry.startTime}–${entry.endTime}`}
      </Text>
      <Text
        style={{ flex: 1, fontSize: 13, fontWeight: '600', color: tokens.color.ink }}
        numberOfLines={1}
      >
        {entry.kind === 'CLASS' && entry.slot ? `${entry.slot.className} · ${entry.slot.subjectName}` : entry.label}
      </Text>
      {entry.kind === 'BREAK' && <Text style={{ color: tokens.color.sub }}>—</Text>}
      {entry.kind === 'CLASS' &&
        // Defensive, like NowCard's `register?.taken` handling: the real API
        // never pairs a CLASS row with a null register today, but if it ever
        // did, fall back to the "not marked" pill rather than rendering
        // nothing — a missing pill reads as "nothing to do here", which is
        // the wrong message for a class that hasn't had attendance taken.
        (entry.register?.taken ? (
          <Pill tone="green">{`✓ ${entry.register.present}/${entry.register.total}`}</Pill>
        ) : entry.slot ? (
          <Pressable testID={`timeline-take-${entry.slot.classSectionId}`} onPress={() => onTakeAttendance(entry.slot!.classSectionId)}>
            <Pill tone="amber">Not marked</Pill>
          </Pressable>
        ) : (
          <Pill tone="amber">Not marked</Pill>
        ))}
    </View>
  );
}

/**
 * The whole day, one row per timetable entry (classes and breaks alike).
 * Entries before `currentIndex` are grouped under "Earlier today" and
 * rendered dimmed; everything from the current entry onward reads as
 * upcoming. No hooks, no fetching — the screen owns `currentIndex` so this
 * component is fully testable from props. Mirrors
 * apps/web/components/teacher/DayTimeline.tsx.
 */
export function DayTimeline({ entries, currentIndex, onTakeAttendance }: DayTimelineProps) {
  if (entries.length === 0) {
    return (
      <Card testID="timeline-empty">
        <Text style={{ color: tokens.color.sub }}>No periods scheduled today.</Text>
      </Card>
    );
  }

  const splitAt = currentIndex > 0 ? currentIndex : 0;
  const earlier = entries.slice(0, splitAt);
  const rest = entries.slice(splitAt);

  return (
    <Card testID="timeline" style={{ paddingVertical: 2 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink, marginTop: 10, marginBottom: 2 }}>
        Today&apos;s timetable
      </Text>
      {earlier.length > 0 && (
        <>
          <Text
            testID="timeline-earlier-label"
            style={{ fontSize: 11, fontWeight: '700', color: tokens.color.sub, marginTop: 8 }}
          >
            Earlier today
          </Text>
          {earlier.map((e) => (
            <Row key={e.periodId} entry={e} dimmed onTakeAttendance={onTakeAttendance} />
          ))}
        </>
      )}
      {rest.map((e) => (
        <Row key={e.periodId} entry={e} dimmed={false} onTakeAttendance={onTakeAttendance} />
      ))}
    </Card>
  );
}
