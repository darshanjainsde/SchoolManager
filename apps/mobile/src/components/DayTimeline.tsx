import { Pressable, Text, View } from 'react-native';
import type { TeacherDayEntry } from '@skoolos/types';
import { Card, Page, PageHeader, Pill, RailRow, RailStatus, type RailState } from './ui';
import { useTokens } from '@/theme/theme-context';

export interface DayTimelineProps {
  entries: TeacherDayEntry[];
  /** Index of the current entry, or -1. Rows before it render dimmed. */
  currentIndex: number;
  onTakeAttendance: (classSectionId: string) => void;
}

/** What this period is doing to the day, in the rail's own vocabulary. */
function stateOf(entry: TeacherDayEntry, dimmed: boolean, current: boolean): RailState {
  if (dimmed) return 'done';
  if (current) return 'now';
  if (entry.kind === 'FREE') return 'free';
  return 'upcoming';
}

/**
 * One entry of the day as a rail row — a line ruled on the day's page rather
 * than a tile floating on it (the pitch's `.rail`). Every row keeps its
 * stacked start/end times in the margin, whatever kind it is: a free period
 * that hides its hours stops being a slot you can plan into, which is the
 * whole reason a teacher reads this list.
 *
 *   • CLASS → the attendance status on the right (✓ present/total, or a
 *     tappable amber "Take now").
 *   • FREE  → the green wash, so a free teaching period never looks like a
 *     break.
 *   • the LIVE row → the amber highlighter wash; earlier rows → .55 opacity.
 */
function Row({
  entry,
  dimmed,
  current,
  first,
  onTakeAttendance,
}: {
  entry: TeacherDayEntry;
  dimmed: boolean;
  current: boolean;
  first: boolean;
  onTakeAttendance: (classSectionId: string) => void;
}) {
  const isClass = entry.kind === 'CLASS';
  const isFree = entry.kind === 'FREE';

  const right = isClass ? (
    // Defensive, like NowCard's `register?.taken` handling: the real API
    // never pairs a CLASS row with a null register today, but if it ever
    // did, fall back to the "Take now" pill rather than rendering nothing.
    entry.register?.taken ? (
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
    )
  ) : isFree ? (
    <View testID={`timeline-free-${entry.periodId}`}>
      <RailStatus tone="good">Free</RailStatus>
    </View>
  ) : (
    <Pill tone="neutral">Break</Pill>
  );

  return (
    <RailRow
      testID={`timeline-row-${entry.periodId}`}
      startTime={entry.startTime}
      endTime={entry.endTime}
      state={stateOf(entry, dimmed, current)}
      first={first}
      title={
        isClass && entry.slot
          ? `${entry.slot.className} · ${entry.slot.subjectName}`
          : isFree
            ? 'Free period'
            : entry.label
      }
      subtitle={
        isClass
          ? current
            ? `${entry.label} · in progress`
            : entry.label
          : isFree
            ? `${entry.label} · prep or catch up`
            : `${entry.startTime}–${entry.endTime}`
      }
      right={right}
    />
  );
}

/**
 * The whole day on one page, one ruled row per timetable entry (classes, free
 * periods and breaks alike). Entries before `currentIndex` are grouped under
 * "Earlier today" and dimmed; everything from the current entry onward reads
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
    <Page testID="timeline">
      <PageHeader title="Today's timetable" />

      {earlier.length > 0 && (
        <>
          {/* A paper tab, not a heading: the pitch's rail runs unbroken down
              the page, so what separates what's done from what's left is a
              small label in the margin, never a gap in the rule. */}
          <Text
            testID="timeline-earlier-label"
            style={{
              fontSize: 11,
              fontWeight: '800',
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: tokens.color.sub,
              paddingTop: 4,
              paddingHorizontal: 12,
              paddingBottom: 2,
            }}
          >
            Earlier today
          </Text>
          {earlier.map((e, i) => (
            <Row
              key={e.periodId}
              entry={e}
              dimmed
              current={false}
              first={i === 0}
              onTakeAttendance={onTakeAttendance}
            />
          ))}
        </>
      )}

      {rest.map((e, ri) => (
        <Row
          key={e.periodId}
          entry={e}
          dimmed={false}
          current={splitAt + ri === currentIndex}
          first={earlier.length === 0 && ri === 0}
          onTakeAttendance={onTakeAttendance}
        />
      ))}
    </Page>
  );
}
