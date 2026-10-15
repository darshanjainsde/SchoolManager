import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CalendarSheet } from './CalendarSheet';
import { Icon } from './icons';
import { weekdayDate } from './Field';
import { shiftISO } from '@/lib/attendance';
import { useTokens } from '@/theme/theme-context';

/**
 * THE DAY CONTROL (sckools-ui-standards, 9 Oct 2026) for screens that page a
 * day at a time — Attendance, Diary. ‹ [the day — tap for a calendar] ›, with
 * "Today"/"Yesterday" said in words, Next stopping at `maxDate`, and a
 * "Back to today" pill whenever you have walked away from today. Replaces the
 * "‹ Prev day · Jump to today · Next day ›" text links.
 */
export function DayControl({
  date,
  today,
  onChange,
  maxDate,
  ids = { prev: 'date-prev', next: 'date-next', pick: 'date-pick', today: 'date-today' },
}: {
  date: string;
  today: string;
  onChange: (iso: string) => void;
  /** Defaults to today: nothing ahead of it can be recorded. */
  maxDate?: string;
  ids?: { prev: string; next: string; pick: string; today: string };
}) {
  const tokens = useTokens();
  const [open, setOpen] = useState(false);
  const max = maxDate ?? today;
  const yesterday = shiftISO(today, -1);
  const big = date === today ? 'Today' : date === yesterday ? 'Yesterday' : weekdayDate(date).replace(/ \d{4}$/, '');
  const small = date === today || date === yesterday ? weekdayDate(date) : 'Tap for a calendar';
  return (
    <View style={{ gap: 10 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          padding: 6,
          borderRadius: 999,
          backgroundColor: tokens.color.surface,
          borderWidth: 1,
          borderColor: tokens.color.line,
        }}
      >
        <DayArrow testID={ids.prev} dir="prev" label="Previous day" onPress={() => onChange(shiftISO(date, -1))} />
        <Pressable
          testID={ids.pick}
          accessibilityRole="button"
          accessibilityLabel={`${weekdayDate(date)}. Opens a calendar.`}
          onPress={() => setOpen(true)}
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44 }}
        >
          <Text style={{ fontSize: 16, fontWeight: '700', color: tokens.color.ink }}>{big}</Text>
          <Text style={{ fontSize: 12.5, color: tokens.color.sub }}>{small}</Text>
        </Pressable>
        <DayArrow
          testID={ids.next}
          dir="next"
          label="Next day"
          disabled={date >= max}
          onPress={() => onChange(date < max ? shiftISO(date, 1) : date)}
        />
      </View>
      {date !== today && (
        <Pressable
          testID={ids.today}
          accessibilityRole="button"
          onPress={() => onChange(today)}
          style={{ alignSelf: 'center', height: 40, paddingHorizontal: 20, borderRadius: 999, justifyContent: 'center', backgroundColor: tokens.color.indigo50 }}
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: tokens.color.indigo }}>Back to today</Text>
        </Pressable>
      )}
      <CalendarSheet
        open={open}
        title="Which day?"
        value={date}
        onPick={(iso) => {
          if (iso > max) return;
          onChange(iso);
        }}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}

/** The round ‹ / › used by every pager (day, month). */
export function DayArrow({ testID, dir, label, onPress, disabled }: { testID: string; dir: 'prev' | 'next'; label: string; onPress: () => void; disabled?: boolean }) {
  const tokens = useTokens();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: disabled ? 'transparent' : tokens.color.indigo50,
        opacity: disabled ? 0.35 : pressed ? 0.7 : 1,
        transform: dir === 'next' ? [{ rotate: '180deg' }] : undefined,
      })}
    >
      <Icon name="chevron" size={20} color={tokens.color.indigo} />
    </Pressable>
  );
}
