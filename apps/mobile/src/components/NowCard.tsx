import { Pressable, Text, View } from 'react-native';
import type { TeacherDayEntry } from '@skoolos/types';
import { Card, Pill } from './ui';
import { tokens } from '@/theme/tokens';

export interface NowCardProps {
  entry: TeacherDayEntry | null;
  /** Minutes elapsed into `entry`; 0 when nothing is current. */
  elapsed: number;
  /** Length of `entry` in minutes; 0 when nothing is current. */
  total: number;
  /** Shown when nothing is current: before school, after school, or in a gap. */
  nextEntry: TeacherDayEntry | null;
  onTakeAttendance: (classSectionId: string) => void;
}

/** "8-A · Mathematics" for a class, or the period's own label ("Break") otherwise. */
function entryLabel(e: TeacherDayEntry): string {
  return e.kind === 'CLASS' && e.slot ? `${e.slot.className} · ${e.slot.subjectName}` : e.label;
}

/**
 * The teacher's "what's happening right now" hero tile. Pure presentational —
 * every state is driven entirely by props (including `elapsed`/`total`, both
 * computed by the caller from `currentEntry`) so it can be tested without a
 * network call or a fake clock of its own.
 *
 * Note on the null-entry states: `entry === null` covers three real
 * situations (before the first period, after the last, or a gap between
 * two), but these props carry no signal that distinguishes "before school"
 * from "a gap mid-day" — both just have some `nextEntry`. Rather than guess
 * and risk telling a teacher mid-morning that "school hasn't started", both
 * share one honest "nothing on right now" message; only the no-`nextEntry`
 * case (the day is genuinely over) gets distinct copy. Mirrors
 * apps/web/components/teacher/NowCard.tsx.
 */
export function NowCard({ entry, elapsed, total, nextEntry, onTakeAttendance }: NowCardProps) {
  if (!entry) {
    return (
      <Card testID="now-card">
        <Text style={{ fontSize: 11, fontWeight: '700', color: tokens.color.sub, textTransform: 'uppercase' }}>
          Right now
        </Text>
        {nextEntry ? (
          <>
            <Text style={{ fontSize: 17, fontWeight: '700', color: tokens.color.ink, marginTop: 4 }}>
              Nothing on right now
            </Text>
            <Text style={{ fontSize: 12.5, color: tokens.color.sub, marginTop: 3 }}>
              {`Next up: ${entryLabel(nextEntry)} at ${nextEntry.startTime}`}
            </Text>
          </>
        ) : (
          <Text style={{ fontSize: 17, fontWeight: '700', color: tokens.color.ink, marginTop: 4 }}>
            That&apos;s it for today
          </Text>
        )}
      </Card>
    );
  }

  if (entry.kind === 'BREAK') {
    return (
      <Card testID="now-card">
        <Text style={{ fontSize: 11, fontWeight: '700', color: tokens.color.sub, textTransform: 'uppercase' }}>
          Right now
        </Text>
        <Text style={{ fontSize: 17, fontWeight: '700', color: tokens.color.ink, marginTop: 4 }}>
          {entry.label}
        </Text>
        {nextEntry ? (
          <Text style={{ fontSize: 12.5, color: tokens.color.sub, marginTop: 3 }}>
            {`Next up: ${entryLabel(nextEntry)} at ${nextEntry.startTime}`}
          </Text>
        ) : (
          <Text style={{ fontSize: 12.5, color: tokens.color.sub, marginTop: 3 }}>
            Nothing scheduled after this.
          </Text>
        )}
      </Card>
    );
  }

  const { slot, register } = entry;
  // A zero-length period can never be `currentEntry`'s pick (see
  // lib/teacher-day.ts), but this component takes `total` as a plain prop
  // and must not assume its caller upheld that invariant — guard the
  // division.
  const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((elapsed / total) * 100))) : 0;

  return (
    <Card testID="now-card">
      <Text style={{ fontSize: 11, fontWeight: '700', color: tokens.color.sub, textTransform: 'uppercase' }}>
        Right now
      </Text>
      <Text style={{ fontSize: 17, fontWeight: '700', color: tokens.color.ink, marginTop: 4 }}>
        {slot ? `${slot.className} · ${slot.subjectName}` : entry.label}
      </Text>
      {slot?.covering && (
        <Text style={{ fontSize: 12, color: tokens.color.amber, fontWeight: '600', marginTop: 2 }}>
          {`Covering for ${slot.coveringFor}`}
        </Text>
      )}

      <View
        testID="now-progress"
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: pct }}
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: tokens.color.line,
          marginTop: 12,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 3,
            backgroundColor: tokens.color.indigo,
          }}
        />
      </View>

      {register?.taken ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 11 }}>
          <Pill tone="green">{`✓ ${register.present}/${register.total} present`}</Pill>
          {register.markedBy && (
            <Text style={{ fontSize: 11.5, color: tokens.color.sub }}>{`Marked by ${register.markedBy}`}</Text>
          )}
        </View>
      ) : (
        slot && (
          <Pressable
            testID={`now-take-${slot.classSectionId}`}
            onPress={() => onTakeAttendance(slot.classSectionId)}
            style={{
              backgroundColor: tokens.color.indigo,
              borderRadius: 13,
              padding: 11,
              marginTop: 11,
              alignSelf: 'flex-start',
              paddingHorizontal: 16,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Take attendance</Text>
          </Pressable>
        )
      )}
    </Card>
  );
}
