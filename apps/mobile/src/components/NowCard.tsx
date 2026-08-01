import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { TeacherDayEntry } from '@skoolos/types';
import { Card } from './ui';
import { useTokens } from '@/theme/theme-context';
import { brand } from '@/theme/tokens';

/** Day-complete wrap-up counts, shown only when the day is genuinely over. */
export interface NowCardSummary {
  /** Number of CLASS entries in the day (FREE/BREAK excluded). */
  classesTaught: number;
  /** Sum of `register.present` across the day's classes. */
  studentsMarked: number;
}

export interface NowCardProps {
  entry: TeacherDayEntry | null;
  /** Minutes elapsed into `entry`; 0 when nothing is current. */
  elapsed: number;
  /** Length of `entry` in minutes; 0 when nothing is current. */
  total: number;
  /** Shown when nothing is current: before school, after school, or in a gap. */
  nextEntry: TeacherDayEntry | null;
  onTakeAttendance: (classSectionId: string) => void;
  /**
   * Day-complete wrap-up figures, used only in the "day over" state
   * (`entry === null && nextEntry === null`). Optional so the other states
   * stay callable without it.
   */
  summary?: NowCardSummary;
}

/** "8-A · Mathematics" for a class, or the period's own label ("Break") otherwise. */
function entryLabel(e: TeacherDayEntry): string {
  return e.kind === 'CLASS' && e.slot ? `${e.slot.className} · ${e.slot.subjectName}` : e.label;
}

// Hero text always sits on a saturated gradient, so its colours are fixed
// white (theme-independent), exactly like AuthScaffold's on-hero text.
const hero = StyleSheet.create({
  eyebrow: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.94)',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: brand.onHero,
    marginTop: 7,
  },
  meta: {
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.93)',
    marginTop: 2,
  },
});

/**
 * A rounded card whose background is a static SVG linear gradient (mirrors
 * `AuthScaffold`'s svg-gradient technique — no animation libraries, no extra
 * native deps beyond `react-native-svg`). The gradient is sized from the
 * card's own `onLayout`, with the first gradient stop as a solid fallback
 * `backgroundColor` so there is never a blank flash before layout (and so it
 * still reads correctly in test renderers, where `onLayout` never fires and
 * the SVG simply isn't drawn).
 */
function GradientHero({
  id,
  colors,
  testID,
  children,
}: {
  id: string;
  colors: readonly [string, string, string];
  testID?: string;
  children: ReactNode;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  return (
    <View
      testID={testID}
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
        <Svg
          width={size.w}
          height={size.h}
          style={{ position: 'absolute', top: 0, left: 0 }}
          pointerEvents="none"
        >
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={colors[0]} />
              <Stop offset="0.5" stopColor={colors[1]} />
              <Stop offset="1" stopColor={colors[2]} />
            </LinearGradient>
          </Defs>
          <Rect width={size.w} height={size.h} fill={`url(#${id})`} />
        </Svg>
      )}
      {children}
    </View>
  );
}

/** Translucent white chip used for counts / hints on top of a hero. */
function HeroChip({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: 'rgba(255,255,255,0.18)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.32)',
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: brand.onHero, fontSize: 12.5, fontWeight: '700' }}>{children}</Text>
    </View>
  );
}

/** A single "5 / classes taught" figure cell in the day-complete summary row. */
function SummaryCell({ value, label }: { value: string; label: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: 'rgba(255,255,255,0.16)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.24)',
        borderRadius: 13,
        paddingHorizontal: 10,
        paddingVertical: 9,
      }}
    >
      <Text style={{ color: brand.onHero, fontSize: 19, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 10.5, fontWeight: '600', marginTop: 1 }}>
        {label}
      </Text>
    </View>
  );
}

/** The pulsing "live" indicator, kept as a simple solid dot (no timers). */
function LiveDot() {
  return (
    <View
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: brand.onHero,
        shadowColor: brand.onHero,
        shadowOpacity: 0.7,
        shadowRadius: 4,
      }}
    />
  );
}

/**
 * The teacher's "what's happening right now" hero tile. Pure presentational —
 * every state is driven entirely by props (including `elapsed`/`total`, both
 * computed by the caller from `currentEntry`) so it can be tested without a
 * network call or a fake clock of its own.
 *
 * One hero shape, the accent swapping with the day's state:
 *   • CLASS  → indigo gradient, live-now eyebrow, progress bar, take-attendance
 *   • FREE   → green gradient, "you're free — N min", next class, calm hint
 *   • day over (`entry === null && nextEntry === null`) → slate→indigo wrap-up
 *     with a summary of classes taught / students marked
 *
 * The two remaining null-entry situations — before the first period and inside
 * a gap — both just have some `nextEntry`, and these props carry no signal to
 * tell them apart. Rather than guess and risk telling a teacher mid-morning
 * that "school hasn't started", they share one honest "nothing on right now"
 * card (kept as a plain surface, not a hero). Mirrors
 * apps/web/components/teacher/NowCard.tsx.
 */
export function NowCard({ entry, elapsed, total, nextEntry, onTakeAttendance, summary }: NowCardProps) {
  const tokens = useTokens();

  // Nothing is current: either the day is over (a wrap-up hero) or we're before
  // school / in a gap (a plain "nothing on" card that names the next class).
  if (!entry) {
    if (!nextEntry) {
      const s = summary ?? { classesTaught: 0, studentsMarked: 0 };
      return (
        <GradientHero id="hero-done" colors={brand.hero.done} testID="now-card">
          <Text style={hero.eyebrow}>🎉 That&apos;s a wrap</Text>
          <Text style={hero.title}>Day complete</Text>
          <Text style={hero.meta}>
            {`${s.classesTaught} ${s.classesTaught === 1 ? 'class' : 'classes'} taught`}
          </Text>
          <View testID="now-summary" style={{ flexDirection: 'row', gap: 8, marginTop: 13 }}>
            <SummaryCell value={String(s.classesTaught)} label="classes taught" />
            <SummaryCell value={String(s.studentsMarked)} label="students marked" />
          </View>
        </GradientHero>
      );
    }
    return (
      <Card testID="now-card">
        <Text style={{ fontSize: 11, fontWeight: '700', color: tokens.color.sub, textTransform: 'uppercase' }}>
          Right now
        </Text>
        <Text style={{ fontSize: 17, fontWeight: '700', color: tokens.color.ink, marginTop: 4 }}>
          Nothing on right now
        </Text>
        <Text style={{ fontSize: 12.5, color: tokens.color.sub, marginTop: 3 }}>
          {`Next up: ${entryLabel(nextEntry)} at ${nextEntry.startTime}`}
        </Text>
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

  if (entry.kind === 'FREE') {
    const remaining = Math.max(0, total - elapsed);
    return (
      <GradientHero id="hero-green" colors={brand.hero.green} testID="now-card">
        <Text style={hero.eyebrow}>{`${entry.label} · Free period`}</Text>
        <Text style={hero.title}>{`You're free — ${remaining} min`}</Text>
        <Text style={hero.meta}>
          {nextEntry
            ? `${entry.startTime}–${entry.endTime} · Next: ${entryLabel(nextEntry)} at ${nextEntry.startTime}`
            : `${entry.startTime}–${entry.endTime}`}
        </Text>
        <View style={{ marginTop: 12 }}>
          <HeroChip>☕ Use it to prep or catch up</HeroChip>
        </View>
      </GradientHero>
    );
  }

  // CLASS — the live-now indigo hero.
  const { slot, register } = entry;
  // A zero-length period can never be `currentEntry`'s pick (see
  // lib/teacher-day.ts), but this component takes `total` as a plain prop and
  // must not assume its caller upheld that invariant — guard the division.
  const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((elapsed / total) * 100))) : 0;

  return (
    <GradientHero id="hero-indigo" colors={brand.hero.indigo} testID="now-card">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <LiveDot />
        <Text style={hero.eyebrow}>{`${entry.label} · Live now`}</Text>
      </View>
      <Text style={hero.title}>{slot ? `${slot.className} · ${slot.subjectName}` : entry.label}</Text>
      <Text style={hero.meta}>{`${entry.startTime}–${entry.endTime}`}</Text>
      {slot?.covering && (
        <Text style={[hero.meta, { fontWeight: '700' }]}>{`Covering for ${slot.coveringFor}`}</Text>
      )}

      <View
        testID="now-progress"
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: pct }}
        style={{
          height: 7,
          borderRadius: 5,
          backgroundColor: 'rgba(255,255,255,0.24)',
          marginTop: 13,
          overflow: 'hidden',
        }}
      >
        <View style={{ width: `${pct}%`, height: '100%', borderRadius: 5, backgroundColor: brand.onHero }} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 12, flexWrap: 'wrap' }}>
        {register?.taken ? (
          <>
            <HeroChip>{`✓ ${register.present}/${register.total} present`}</HeroChip>
            {register.markedBy && (
              <Text style={hero.meta}>{`Marked by ${register.markedBy}`}</Text>
            )}
          </>
        ) : (
          slot && (
            <Pressable
              testID={`now-take-${slot.classSectionId}`}
              onPress={() => onTakeAttendance(slot.classSectionId)}
              style={{
                backgroundColor: brand.onHero,
                borderRadius: 13,
                paddingVertical: 11,
                paddingHorizontal: 16,
                alignSelf: 'flex-start',
              }}
            >
              <Text style={{ color: brand.hero.ctaInk, fontWeight: '800', fontSize: 13 }}>
                Take attendance →
              </Text>
            </Pressable>
          )
        )}
      </View>
    </GradientHero>
  );
}
