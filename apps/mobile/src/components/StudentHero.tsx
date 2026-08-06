import { useState, type ReactNode } from 'react';
import { Text, View, type TextStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTokens } from '@/theme/theme-context';
import { brand } from '@/theme/tokens';

/** The class a student is in right now. */
export interface StudentHeroCurrent {
  subjectName: string;
  teacherName: string;
  periodLabel: string;
  startTime: string;
  endTime: string;
}
/** The next class today (before school, or in a gap between periods). */
export interface StudentHeroNext {
  subjectName: string;
  teacherName: string;
  startTime: string;
}
export type TodayStatus = 'PRESENT' | 'ABSENT' | 'LATE' | null;

export interface StudentHeroProps {
  /** The current class, or null when nothing is on right now. */
  current: StudentHeroCurrent | null;
  /** Minutes into `current`; ignored when `current` is null. */
  elapsed: number;
  /** Length of `current` in minutes; ignored when `current` is null. */
  total: number;
  /** The next class today, or null when the day is over. */
  next: StudentHeroNext | null;
  todayStatus: TodayStatus;
  /** false → a weekend/holiday with no timetable today (the "no school" state). */
  hasSchoolToday: boolean;
  classesToday: number;
  monthPercent: number | null;
}

// On-hero text takes the hero's own on-fill ink. Since pitch №4 the live /
// next / done gradients are the CHOSEN accent (same fix as the teacher's
// NowCard — accents.ts always said its fill paints the Now card); only the
// no-school hero keeps a fixed green + white, because there green MEANS
// "no school today".
function heroText(on: string): { eyebrow: TextStyle; title: TextStyle; meta: TextStyle } {
  return {
    eyebrow: {
      fontSize: 10.5,
      fontWeight: '800',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: on,
      opacity: 0.94,
    },
    title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, color: on, marginTop: 7 },
    meta: { fontSize: 12.5, color: on, opacity: 0.93, marginTop: 2 },
  };
}

/** SVG-gradient rounded card — mirrors NowCard's GradientHero (first stop is a
 *  solid fallback so there's no blank flash before onLayout, and it still reads
 *  in test renderers where onLayout never fires). */
function Gradient({
  id,
  colors,
  children,
}: {
  id: string;
  colors: readonly string[];
  children: ReactNode;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  return (
    <View
      testID="student-hero"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
      }}
      style={{
        borderRadius: 22,
        padding: 16,
        overflow: 'hidden',
        backgroundColor: colors[0],
        shadowColor: brand.hero.shadow,
        shadowOpacity: 0.35,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 14 },
        elevation: 8,
      }}
    >
      {size.w > 0 && (
        <Svg width={size.w} height={size.h} style={{ position: 'absolute', top: 0, left: 0 }} pointerEvents="none">
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              {colors.map((c, i) => (
                <Stop key={c + String(i)} offset={String(i / (colors.length - 1))} stopColor={c} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect width={size.w} height={size.h} fill={`url(#${id})`} />
        </Svg>
      )}
      {children}
    </View>
  );
}

function Chip({ on, children }: { on: string; children: ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: `${on}2E`,
        borderWidth: 1,
        borderColor: `${on}52`,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        alignSelf: 'flex-start',
        marginTop: 12,
      }}
    >
      <Text style={{ color: on, fontSize: 12.5, fontWeight: '700' }}>{children}</Text>
    </View>
  );
}

function Cell({ on, value, label }: { on: string; value: string; label: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: `${on}29`,
        borderWidth: 1,
        borderColor: `${on}3D`,
        borderRadius: 13,
        paddingHorizontal: 10,
        paddingVertical: 9,
      }}
    >
      <Text style={{ color: on, fontSize: 19, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: on, opacity: 0.9, fontSize: 10.5, fontWeight: '600', marginTop: 1 }}>{label}</Text>
    </View>
  );
}

function LiveDot({ on }: { on: string }) {
  return (
    <View
      style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: on, shadowColor: on, shadowOpacity: 0.7, shadowRadius: 4 }}
    />
  );
}

function statusChip(status: TodayStatus): string | null {
  if (status === 'PRESENT') return '✓ Present today';
  if (status === 'LATE') return '⏱ Late today';
  if (status === 'ABSENT') return '✕ Absent today';
  return null;
}

function attendanceGlyph(status: TodayStatus): string {
  if (status === 'PRESENT') return '✓';
  if (status === 'LATE') return '⏱';
  if (status === 'ABSENT') return '✕';
  return '—';
}

/**
 * The student's "what's on right now" hero — one gradient card, its accent and
 * message swapping with the school day, driven entirely by props (so it's
 * testable without a clock or a network). Role-neutral: with one shared STUDENT
 * login it must read correctly whether a student or a parent holds the phone,
 * so nothing says "you"/"your child".
 *
 *   • no school today       → green "enjoy the day off"
 *   • a class on now         → indigo, live dot, progress bar, today's status
 *   • day over               → slate→indigo wrap-up with a small summary
 *   • before school / a gap  → indigo "up next", names the next class
 */
export function StudentHero(props: StudentHeroProps) {
  const { current, elapsed, total, next, todayStatus, hasSchoolToday, classesToday, monthPercent } = props;
  const tokens = useTokens();
  // The chosen accent paints the live/next/done heroes (pitch №4); the
  // no-school hero below stays fixed green + white — semantic, not decor.
  const accentColors = [tokens.color.indigo, tokens.color.indigoDeep] as const;
  const on = tokens.color.onBrand;
  const t = heroText(on);
  const chip = statusChip(todayStatus);

  if (!hasSchoolToday) {
    const holi = heroText(brand.onHero);
    return (
      <Gradient id="shero-holi" colors={brand.hero.green}>
        <Text style={holi.eyebrow}>🌴 No school today</Text>
        <Text style={holi.title}>Enjoy the day off</Text>
        <Text style={holi.meta}>No classes are scheduled for today.</Text>
      </Gradient>
    );
  }

  if (current) {
    const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((elapsed / total) * 100))) : 0;
    const remaining = Math.max(0, total - elapsed);
    return (
      <Gradient id="shero-live" colors={accentColors}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <LiveDot on={on} />
          <Text style={t.eyebrow}>In class now</Text>
        </View>
        <Text style={t.title}>{current.subjectName}</Text>
        <Text style={t.meta}>{`${current.teacherName} · ${current.periodLabel} · ends ${current.endTime}`}</Text>
        <View
          testID="shero-progress"
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: pct }}
          style={{ height: 7, borderRadius: 5, backgroundColor: `${on}40`, marginTop: 13, overflow: 'hidden' }}
        >
          <View style={{ width: `${pct}%`, height: '100%', borderRadius: 5, backgroundColor: on }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 }}>
          <Text style={t.meta}>{`Started ${current.startTime}`}</Text>
          <Text style={t.meta}>{`${remaining} min left`}</Text>
        </View>
        {chip && <Chip on={on}>{chip}</Chip>}
      </Gradient>
    );
  }

  if (!next) {
    return (
      <Gradient id="shero-done" colors={accentColors}>
        <Text style={t.eyebrow}>🎒 That&apos;s a wrap</Text>
        <Text style={t.title}>School&apos;s done for today</Text>
        <Text style={t.meta}>{`${classesToday} ${classesToday === 1 ? 'class' : 'classes'} today`}</Text>
        <View testID="shero-summary" style={{ flexDirection: 'row', gap: 8, marginTop: 13 }}>
          <Cell on={on} value={String(classesToday)} label="classes today" />
          <Cell on={on} value={attendanceGlyph(todayStatus)} label="attendance" />
          <Cell on={on} value={monthPercent != null ? `${monthPercent}%` : '—'} label="this month" />
        </View>
      </Gradient>
    );
  }

  return (
    <Gradient id="shero-next" colors={accentColors}>
      <Text style={t.eyebrow}>Up next</Text>
      <Text style={t.title}>{next.subjectName}</Text>
      <Text style={t.meta}>{`${next.teacherName} · at ${next.startTime}`}</Text>
      {chip && <Chip on={on}>{chip}</Chip>}
    </Gradient>
  );
}
