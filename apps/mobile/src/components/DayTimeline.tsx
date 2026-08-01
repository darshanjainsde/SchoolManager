import { Pressable, Text, View } from 'react-native';
import type { TeacherDayEntry } from '@skoolos/types';
import { Card, Pill } from './ui';
import { useTokens } from '@/theme/theme-context';

export interface DayTimelineProps {
  entries: TeacherDayEntry[];
  /** Index of the current entry, or -1. Rows before it render dimmed. */
  currentIndex: number;
  onTakeAttendance: (classSectionId: string) => void;
}

/**
 * One entry of the day, rendered as a self-contained rail tile:
 *   • CLASS → indigo lead bar, a stacked start/end time, and the attendance
 *     pill (✓ present/total, or a tappable amber "Take now").
 *   • FREE  → a distinct GREEN tile ("Free period", green "Free" pill) so a
 *     free teaching period never looks like a break.
 *   • BREAK → a neutral/grey tile with a ghost "Break" pill.
 * Rows before the current one render dimmed.
 */
function Row({
  entry,
  dimmed,
  current,
  onTakeAttendance,
}: {
  entry: TeacherDayEntry;
  dimmed: boolean;
  current: boolean;
  onTakeAttendance: (classSectionId: string) => void;
}) {
  const tokens = useTokens();
  const isClass = entry.kind === 'CLASS';
  const isFree = entry.kind === 'FREE';
  const isBreak = entry.kind === 'BREAK';

  const leadColor = isFree ? tokens.color.green : isBreak ? tokens.color.sub : tokens.color.indigo;
  const borderColor = current
    ? tokens.color.indigo
    : isFree
      ? tokens.color.green
      : tokens.color.line;

  return (
    <View
      testID={`timeline-row-${entry.periodId}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        backgroundColor: isFree ? tokens.color.green50 : tokens.color.surface,
        borderWidth: 1,
        borderColor,
        borderRadius: 15,
        padding: 11,
        opacity: dimmed ? 0.5 : 1,
      }}
    >
      <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, backgroundColor: leadColor }} />

      {isClass ? (
        <View style={{ width: 44 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: tokens.color.sub }}>{entry.startTime}</Text>
          <Text style={{ fontSize: 11, fontWeight: '700', color: tokens.color.sub }}>{entry.endTime}</Text>
        </View>
      ) : (
        <View
          testID={isFree ? `timeline-free-${entry.periodId}` : undefined}
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: isFree ? tokens.color.green50 : tokens.color.surfaceMuted,
          }}
        >
          <Text style={{ fontSize: 14 }}>{isFree ? '☕' : '🍽️'}</Text>
        </View>
      )}

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            fontSize: 13.5,
            fontWeight: '700',
            color: isFree ? tokens.color.green : tokens.color.ink,
          }}
        >
          {isClass && entry.slot
            ? `${entry.slot.className} · ${entry.slot.subjectName}`
            : isFree
              ? 'Free period'
              : entry.label}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 11, color: tokens.color.sub, marginTop: 1 }}>
          {isClass
            ? current
              ? `${entry.label} · in progress`
              : entry.label
            : isFree
              ? `${entry.label} · prep or catch up`
              : `${entry.startTime}–${entry.endTime}`}
        </Text>
      </View>

      {isClass &&
        // Defensive, like NowCard's `register?.taken` handling: the real API
        // never pairs a CLASS row with a null register today, but if it ever
        // did, fall back to the "Take now" pill rather than rendering nothing.
        (entry.register?.taken ? (
          <Pill tone="green">{`✓ ${entry.register.present}/${entry.register.total}`}</Pill>
        ) : entry.slot ? (
          <Pressable
            testID={`timeline-take-${entry.slot.classSectionId}`}
            onPress={() => onTakeAttendance(entry.slot!.classSectionId)}
          >
            <Pill tone="amber">Take now</Pill>
          </Pressable>
        ) : (
          <Pill tone="amber">Take now</Pill>
        ))}
      {isFree && <Pill tone="green">Free</Pill>}
      {isBreak && <Pill tone="neutral">Break</Pill>}
    </View>
  );
}

/**
 * The whole day, one tile per timetable entry (classes, free periods and
 * breaks alike). Entries before `currentIndex` are grouped under "Earlier
 * today" and rendered dimmed; everything from the current entry onward reads
 * as upcoming. No hooks beyond theming, no fetching — the screen owns
 * `currentIndex` so this component is fully testable from props. Mirrors
 * apps/web/components/teacher/DayTimeline.tsx.
 */
export function DayTimeline({ entries, currentIndex, onTakeAttendance }: DayTimelineProps) {
  const tokens = useTokens();
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
    <View testID="timeline">
      <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink, marginBottom: 2 }}>
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
          <View style={{ gap: 9, marginTop: 8 }}>
            {earlier.map((e) => (
              <Row key={e.periodId} entry={e} dimmed current={false} onTakeAttendance={onTakeAttendance} />
            ))}
          </View>
        </>
      )}

      <View style={{ gap: 9, marginTop: 8 }}>
        {rest.map((e, ri) => (
          <Row
            key={e.periodId}
            entry={e}
            dimmed={false}
            current={splitAt + ri === currentIndex}
            onTakeAttendance={onTakeAttendance}
          />
        ))}
      </View>
    </View>
  );
}
