import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, Text, View, type TextStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { TeacherDayEntry } from '@skoolos/types';
import { Card } from './ui';
import { Touchable } from './Touchable';
import { CountUp } from './CountUp';
import { useTokens } from '@/theme/theme-context';
import { brand, font } from '@/theme/tokens';
import { DUR, inkWidth, useGesture, useReduceMotion } from '@/theme/motion';

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
   * Opens the class itself — the roster, who is out, the notes. Optional so
   * the card stays renderable (and testable) without a navigator; when it is
   * omitted the hero is simply not tappable, rather than tappable-and-inert.
   */
  onOpenClass?: (classSectionId: string) => void;
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

// Hero text sits on a saturated gradient. Since pitch №3 that gradient is the
// CHOSEN accent (see `useHeroStyles`), whose `onBrand` token is guaranteed
// legible on its own fill in both schemes — so hero text is `onBrand`, not
// hardcoded white. Numbers are the pitch's `.nowcard` (`.eye` / `.big` /
// `.met`): the eyebrow is small, wide-tracked and shouty; the headline is the
// diary SERIF, because even the one saturated card in the teacher's day is
// still a page of the same book.
function heroStyles(on: string): { eyebrow: TextStyle; title: TextStyle; meta: TextStyle } {
  return {
    eyebrow: {
      fontSize: 9.5,
      fontWeight: '800',
      letterSpacing: 1.33, // .14em at 9.5px
      textTransform: 'uppercase',
      color: on,
      opacity: 0.9,
    },
    title: {
      fontFamily: font.serif,
      fontSize: 20,
      fontWeight: '600',
      color: on,
      marginTop: 5,
      marginBottom: 1,
    },
    meta: {
      // 12.5, not the repaint's 11: this line carries the class, the subject and
      // who is being covered for, on the one card a teacher reads mid-corridor.
      fontSize: 12.5,
      color: on,
      opacity: 0.93,
    },
  };
}

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
  /** 16 on the live-class hero, which carries the most and is tapped as a whole. */
  padding = 14,
  children,
}: {
  id: string;
  colors: readonly string[];
  testID?: string;
  padding?: number;
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
        // `.nowcard` — radius 16: a card on the page, not a slab. Same lift as
        // a `Page`, in ink rather than neutral grey.
        borderRadius: 16,
        padding,
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
            {/* 135deg, exactly as the pitch writes it. */}
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

/** Translucent on-hero chip used for counts / hints on top of a hero. `on` is
 *  the hero's own on-fill ink (accent `onBrand`, or fixed white on the green
 *  free hero), alpha-suffixed for the wash so the chip belongs to whichever
 *  gradient it sits on. */
function HeroChip({ on, children }: { on: string; children: ReactNode }) {
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
      }}
    >
      <Text style={{ color: on, fontSize: 12.5, fontWeight: '700' }}>{children}</Text>
    </View>
  );
}

/**
 * A single "5 / classes taught" figure cell in the day-complete summary row.
 *
 * The figure counts up, and this is the one card in the app where that is
 * right: the day is over, nothing here will change again, and the number is
 * the point of the card rather than a side effect of what you are doing.
 */
function SummaryCell({
  on,
  value,
  label,
  testID,
}: {
  on: string;
  value: number;
  label: string;
  testID?: string;
}) {
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
      <CountUp testID={testID} value={value} style={{ color: on, fontSize: 19, fontWeight: '800' }} />
      <Text style={{ color: on, opacity: 0.9, fontSize: 10.5, fontWeight: '600', marginTop: 1 }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * `.livedot` — the 7px dot that pulses beside "live now".
 *
 * NOT one of the six gestures, deliberately. The six all mark a CHANGE to the
 * page (a tick, a stamp, a pin…) and each one runs exactly once because the
 * thing it marks happened exactly once. This marks no change at all: it is a
 * heartbeat saying the card is speaking in the present tense, which is why it
 * is the only motion in this app allowed to repeat forever. The pitch draws it
 * as an expanding ring of white that fades (`box-shadow: 0 0 0 8px` → 0
 * opacity); a scaling, fading sibling view is the same beat in RN, and both
 * of its animated props are transform/opacity so it can ride the native
 * driver and never touch the JS thread.
 *
 * Reduce-motion leaves the plain dot: the word "live now" is next to it, so
 * nothing is lost.
 */
function LiveDot({ on }: { on: string }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const reduced = useReduceMotion();
  useEffect(() => {
    if (reduced.current) return;
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: DUR.pulse,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);

  return (
    <View style={{ width: 7, height: 7, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: 7,
          height: 7,
          borderRadius: 3.5,
          backgroundColor: on,
          // The ring reaches 0 opacity at 70% of the beat and then rests, so
          // the pulse is a beat followed by a pause — a pulse, not a strobe.
          opacity: pulse.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.6, 0, 0] }),
          transform: [
            { scale: pulse.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 3.3, 3.3] }) },
          ],
        }}
      />
      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: on }} />
    </View>
  );
}

/**
 * `.nowprog` — THE INK LINE. A 5px rule under the hero that grows from
 * nothing to how far through the period we are, 0.3s after the card lands.
 *
 * It is the Ink Line rather than a progress bar because of what it measures:
 * a lesson being used up. A bar that simply appeared at 58% would state a
 * fact; a rule that draws itself to 58% says the lesson has been running,
 * which is the thing a teacher glancing at this card actually wants to feel.
 */
function NowProgress({ on, percent }: { on: string; percent: number }) {
  const ink = useGesture(true, DUR.ink, { native: false, delay: 300 });
  return (
    <View
      testID="now-progress"
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={{
        height: 5,
        borderRadius: 99,
        backgroundColor: `${on}40`,
        marginTop: 10,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={{ width: inkWidth(ink, percent), height: '100%', borderRadius: 99, backgroundColor: on }}
      />
    </View>
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
export function NowCard({
  entry,
  elapsed,
  total,
  nextEntry,
  onTakeAttendance,
  onOpenClass,
  summary,
}: NowCardProps) {
  const tokens = useTokens();
  // Pitch №3: the wrap and live heroes paint with the CHOSEN accent — the
  // fill→deep gradient and its own on-fill ink — so they follow the person's
  // Profile choice, the school brand and the colour scheme. The free hero
  // stays the fixed green below: there, green MEANS "you're free".
  const accentColors = [tokens.color.indigo, tokens.color.indigoDeep] as const;
  const on = tokens.color.onBrand;
  const hero = heroStyles(on);

  // Nothing is current: either the day is over (a wrap-up hero) or we're before
  // school / in a gap (a plain "nothing on" card that names the next class).
  if (!entry) {
    if (!nextEntry) {
      const s = summary ?? { classesTaught: 0, studentsMarked: 0 };
      return (
        <GradientHero id="hero-done" colors={accentColors} testID="now-card">
          <Text style={hero.eyebrow}>🎉 That&apos;s a wrap</Text>
          <Text style={hero.title}>Day complete</Text>
          <Text style={hero.meta}>
            {`${s.classesTaught} ${s.classesTaught === 1 ? 'class' : 'classes'} taught`}
          </Text>
          <View testID="now-summary" style={{ flexDirection: 'row', gap: 8, marginTop: 13 }}>
            <SummaryCell on={on} testID="summary-classes" value={s.classesTaught} label="classes taught" />
            <SummaryCell on={on} testID="summary-marked" value={s.studentsMarked} label="students marked" />
          </View>
        </GradientHero>
      );
    }
    return (
      <Card testID="now-card">
        <Text style={{ fontSize: 11, fontWeight: '700', color: tokens.color.sub, textTransform: 'uppercase' }}>
          Right now
        </Text>
        <Text style={{ fontFamily: font.serif, fontSize: 17, fontWeight: '600', color: tokens.color.ink, marginTop: 4 }}>
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
        <Text style={{ fontFamily: font.serif, fontSize: 17, fontWeight: '600', color: tokens.color.ink, marginTop: 4 }}>
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
    // Fixed white on the fixed green — deliberately NOT the accent's onBrand,
    // which can be dark ink and would vanish on this gradient.
    const freeHero = heroStyles(brand.onHero);
    return (
      <GradientHero id="hero-green" colors={brand.hero.green} testID="now-card">
        <Text style={freeHero.eyebrow}>{`${entry.label} · Free period`}</Text>
        <Text style={freeHero.title}>{`You're free — ${remaining} min`}</Text>
        <Text style={freeHero.meta}>
          {nextEntry
            ? `${entry.startTime}–${entry.endTime} · Next: ${entryLabel(nextEntry)} at ${nextEntry.startTime}`
            : `${entry.startTime}–${entry.endTime}`}
        </Text>
        <View style={{ marginTop: 12 }}>
          <HeroChip on={brand.onHero}>☕ Use it to prep or catch up</HeroChip>
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

  const openable = onOpenClass && slot ? () => onOpenClass(slot.classSectionId) : null;

  const card = (
    <GradientHero id="hero-indigo" colors={accentColors} testID="now-card" padding={16}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <LiveDot on={on} />
        <Text style={hero.eyebrow}>{`${entry.label} · Live now`}</Text>
      </View>
      <Text style={hero.title}>{slot ? `${slot.className} · ${slot.subjectName}` : entry.label}</Text>
      <Text style={hero.meta}>{`${entry.startTime}–${entry.endTime}`}</Text>
      {slot?.covering && (
        <Text style={[hero.meta, { fontWeight: '700' }]}>{`Covering for ${slot.coveringFor}`}</Text>
      )}

      <NowProgress on={on} percent={pct} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 10, flexWrap: 'wrap' }}>
        {register?.taken ? (
          <>
            <HeroChip on={on}>{`✓ ${register.present}/${register.total} present`}</HeroChip>
            {register.markedBy && (
              <Text style={hero.meta}>{`Marked by ${register.markedBy}`}</Text>
            )}
          </>
        ) : (
          slot && (
            <Pressable
              testID={`now-take-${slot.classSectionId}`}
              onPress={() => onTakeAttendance(slot.classSectionId)}
              // `.nowbtn` — white paper on the saturated card, so the one
              // thing the teacher is being asked to do is the one thing on
              // this card that looks like a page.
              // Kept at button size. The repaint took it to 12px text in
              // 9x14 padding — this is the card's ONE call to action, and the
              // hardest tap in the app to land while walking.
              style={{
                backgroundColor: on,
                borderRadius: 12,
                paddingVertical: 11,
                paddingHorizontal: 16,
                alignSelf: 'flex-start',
              }}
            >
              <Text style={{ color: tokens.color.indigoDeep, fontWeight: '800', fontSize: 13 }}>
                Take attendance →
              </Text>
            </Pressable>
          )
        )}
      </View>

      {/* THE WAY INTO THE ROOM. A rule and a line of text rather than a second
          button competing with the one above it: taking the register is the
          action, looking at who is in the room is the follow-on. It is its own
          Pressable (not just decoration on the tappable card) so a screen
          reader gets a real, named button rather than a sentence it cannot
          act on. */}
      {openable && (
        <Pressable
          testID={`now-open-${slot!.classSectionId}`}
          accessibilityRole="button"
          accessibilityLabel={`Open ${slot!.className}, see who is in the room`}
          onPress={openable}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 13,
            paddingTop: 11,
            borderTopWidth: 1,
            borderTopColor: `${on}3D`,
          }}
        >
          <Text style={{ color: on, opacity: 0.93, fontSize: 12, fontWeight: '700' }}>
            See who&apos;s in the room
          </Text>
          <Text style={{ color: on, fontSize: 15, fontWeight: '800' }}>›</Text>
        </Pressable>
      )}
    </GradientHero>
  );

  if (!openable) return card;
  // The WHOLE hero is the target, not just the line at its foot — it is the
  // largest thing on Home and a teacher reaching for it mid-corridor should
  // not have to land on a 20px row. `accessible={false}` keeps that
  // convenience from collapsing the card into one VoiceOver element and
  // hiding the two real buttons inside it.
  return (
    <Touchable testID="now-card-press" accessible={false} onPress={openable}>
      {card}
    </Touchable>
  );
}
