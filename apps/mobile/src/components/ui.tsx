import { useRef, type PropsWithChildren, type ReactNode } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useTokens, useTheme } from '@/theme/theme-context';
import { PaperRuling } from './PaperRuling';
import { font, type ColorPalette } from '@/theme/tokens';
import { DASH, DUR, inkWidth, strokeDashoffset, useGesture } from '@/theme/motion';

export function Screen({ children }: PropsWithChildren) {
  const tokens = useTokens();
  // The person's chosen ruling, painted once here so every screen inherits it
  // rather than each one remembering to draw its own paper.
  const { pattern } = useTheme();
  // Top safe-area inset (Phase 5·0b): with headerShown:false the tab
  // navigator renders from the very top of the display, so without this the
  // first line of every screen ("Hi, {name}") sits under the status bar on
  // real devices. One fix here covers every screen; the tab bar's bottom
  // inset is handled by the navigator's own `insets` prop.
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.appBg }}>
      <PaperRuling pattern={pattern} ink={tokens.color.ink} />
      <ScrollView
      testID="screen-scroll"
      style={{ flex: 1, backgroundColor: 'transparent' }}
      contentContainerStyle={{
        paddingTop: insets.top + 10,
        paddingHorizontal: 14,
        gap: tokens.gap,
        paddingBottom: 28,
      }}
    >
      {children}
      </ScrollView>
    </View>
  );
}

/**
 * A padded box for prose — the pitch's `.panel`.
 *
 * The lift is the pitch's `--shadow`
 * (`0 1px 2px rgba(33,29,69,.05), 0 14px 34px -22px rgba(33,29,69,.35)`).
 * Note the colour: `rgba(33,29,69)` IS `--ink`, so paper is lifted by
 * ink-coloured shade rather than by neutral grey — the same trick that makes
 * a printed page look like it is resting on a desk instead of floating in a
 * UI. React Native allows one shadow per view, so the far soft one wins and
 * the 1px contact shadow is folded into it.
 */
export function Card({
  children,
  style,
  testID,
}: PropsWithChildren<{ style?: ViewStyle; testID?: string }>) {
  const tokens = useTokens();
  return (
    <View
      testID={testID}
      style={[{ backgroundColor: tokens.color.surface, borderColor: tokens.color.line,
      borderWidth: 1, borderRadius: tokens.radius.card, padding: 14,
      shadowColor: tokens.color.ink, shadowOpacity: 0.05, shadowRadius: 34,
      shadowOffset: { width: 0, height: 14 }, elevation: 2 }, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({ title, actionLabel, onAction, right }:
  { title: string; actionLabel?: string; onAction?: () => void; right?: ReactNode }) {
  const tokens = useTokens();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      marginHorizontal: 4, marginTop: 6, marginBottom: -3 }}>
      {/* The diary's own voice is the SERIF — that is the whole typographic
          argument of the repaint. Headings, entries, remarks and empty pages
          are set in a book face; the sans is reserved for chrome a paper
          diary would never contain (buttons, counts, meta). The pitch's 650
          weight has no RN equivalent, so serif headings land on '600'. */}
      <Text style={{ fontSize: 15, fontFamily: font.serif, fontWeight: '600',
        letterSpacing: -0.2, color: tokens.color.ink }}>{title}</Text>
      {right ?? (actionLabel && (
        <Pressable onPress={onAction}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: tokens.color.indigo }}>{actionLabel}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * The pitch's `.empty` — "A clean page — nothing written this day."
 *
 * Serif ITALIC, centred, in `--ink-3`: an empty state written in the diary's
 * own hand rather than in system-grey UI text, so a page with nothing on it
 * still reads as a page and not as a failure. Meant to sit inside a `Page`
 * (or a zero-padded `Card`), exactly as the pitch nests `.empty` in `.page`.
 */
export function Empty({ children, testID }: PropsWithChildren<{ testID?: string }>) {
  const tokens = useTokens();
  return (
    <View testID={testID} style={{ paddingVertical: 20, paddingHorizontal: 14, alignItems: 'center' }}>
      <Text
        style={{
          color: tokens.color.sub,
          fontSize: 13,
          lineHeight: 19,
          fontStyle: 'italic',
          fontFamily: font.serif,
          textAlign: 'center',
        }}
      >
        {children}
      </Text>
    </View>
  );
}

/**
 * `.page` — a leaf of the diary. Every list on a repainted screen sits on one
 * of these: paper surface, a single pencil rule around it, radius 14, and
 * `overflow: hidden` so the rules INSIDE it (row borders, the live ink line)
 * are trimmed by the page edge exactly like ink stops at the edge of paper.
 *
 * Distinct from `Card`, which is a padded box for prose. A `Page` has NO
 * padding: its children are full-bleed rows that draw their own rules.
 */
export function Page({
  children,
  style,
  testID,
}: PropsWithChildren<{ style?: ViewStyle; testID?: string }>) {
  const tokens = useTokens();
  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: tokens.color.surface,
          borderColor: tokens.color.line,
          borderWidth: 1,
          borderRadius: 14,
          overflow: 'hidden',
          shadowColor: tokens.color.ink,
          shadowOpacity: 0.05,
          shadowRadius: 34,
          shadowOffset: { width: 0, height: 14 },
          elevation: 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * `.ph` — a page's own heading: the title in the diary SERIF (the voice of
 * the page itself), an optional action in small bold indigo (the voice of the
 * app). Sits inside a `Page`, above its rows.
 */
export function PageHeader({
  title,
  icon,
  actionLabel,
  onAction,
  actionTestID,
}: {
  title: string;
  /**
   * The pitch writes its page titles as "📔 Today's diary" — the glyph is
   * part of the heading. It is a SEPARATE node here so the heading's own
   * words stay one exact, matchable string (an emoji welded onto the title
   * silently breaks every assertion and every screen reader).
   */
  icon?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionTestID?: string;
}) {
  const tokens = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 9,
        paddingHorizontal: 12,
        paddingBottom: 6,
      }}
    >
      {/* The pitch's 650 weight has no RN equivalent (only the 100-900
          ladder), so every serif heading in this app lands on '600'. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
        {icon ? <Text style={{ fontSize: 14 }}>{icon}</Text> : null}
        <Text
          style={{ fontFamily: font.serif, fontSize: 14, fontWeight: '600', color: tokens.color.ink, flex: 1 }}
          numberOfLines={1}
        >
          {title}
        </Text>
      </View>
      {actionLabel && (
        <Pressable testID={actionTestID} onPress={onAction} hitSlop={6}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: tokens.color.indigo }}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Unique-per-instance gradient ids: two `<Svg>` roots sharing a `<Defs>` id
 *  is the classic way to get one row's wash painted with another's colours. */
let washSeq = 0;

/**
 * The row wash: `linear-gradient(90deg, <tint>, transparent 85%)` — a
 * highlighter stroke that runs out of ink before it reaches the right edge,
 * which is what stops a highlighted row from reading as a solid block of
 * colour. Drawn with the SVG already in this app (no new dependency), sized in
 * percentages so it needs no `onLayout` round-trip.
 *
 * `endStop` is where the ink runs out: 0.85 for a highlighted period row
 * (`.rowln.now`), 0.92 for a remark's red bleed (`.diary-item.rem`) — a
 * remark's wash reaches further because it is the whole line that is written
 * in another pen, not just a row that happens to be live.
 */
export function RowWash({ color, endStop = 0.85 }: { color: string; endStop?: number }) {
  const id = useRef(`wash${(washSeq += 1)}`).current;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={color} stopOpacity="1" />
          <Stop offset={String(endStop)} stopColor={color} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

/** What a period is doing to the day, which decides how its row is inked. */
export type RailState = 'now' | 'done' | 'free' | 'upcoming';

export interface RailRowProps {
  startTime: string;
  endTime: string;
  title: string;
  subtitle?: string;
  /** The right-hand `.st` slot: a status word, a pill, a tappable action. */
  right?: ReactNode;
  state: RailState;
  /** The first row in a page has no rule above it — the page edge is the rule. */
  first?: boolean;
  /**
   * THE INK LINE. A percentage 0-100 that grows a 2px indigo rule along the
   * bottom of this row from the margin outward. Only ever passed for the LIVE
   * row: it is the period bleeding away, drawn as ink because a diary marks
   * elapsed time by how much of the line is already written, not by a number.
   */
  inkPercent?: number;
  testID?: string;
  style?: ViewStyle;
}

/**
 * `.rowln` / `.rail` — one period on a day's page, shared by the family's
 * "Today's classes" and the teacher's day.
 *
 * The anatomy is the pitch's, and each part is load-bearing:
 *   • a mono time column, so 09:55 and 11:35 line up as a column of figures;
 *   • the RED MARGIN RULE — the printed line down a school exercise book,
 *     which is why the times read as being written in the margin and the
 *     lesson as being written in the body;
 *   • `now` → the amber highlighter wash, `free` → the green one,
 *     `done` → .55 opacity, because a finished period should still be
 *     readable (it is the record of the day) but must stop asking for
 *     attention.
 */
export function RailRow({
  startTime,
  endTime,
  title,
  subtitle,
  right,
  state,
  first,
  inkPercent,
  testID,
  style,
}: RailRowProps) {
  const tokens = useTokens();
  const ink = useGesture(inkPercent != null, DUR.ink, { native: false, delay: 300 });
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 40,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: tokens.color.line,
        opacity: state === 'done' ? 0.55 : 1,
        ...style,
      }}
    >
      {state === 'now' && <RowWash color={tokens.color.amber50} />}
      {state === 'free' && <RowWash color={tokens.color.green50} />}

      {/* The margin figures stay at the list's own reading size. The repaint
          shipped these at 9px, which is below the smallest size iOS and
          Android will render legibly on a real handset — a time column you
          have to squint at is not a time column. */}
      <Text
        style={{
          width: 52,
          textAlign: 'center',
          fontFamily: font.mono,
          fontSize: 11,
          lineHeight: 14,
          color: tokens.color.sub,
        }}
      >
        {startTime}
        {'\n'}
        {endTime}
      </Text>
      <View style={{ width: 1.5, alignSelf: 'stretch', backgroundColor: tokens.color.marginRed, opacity: 0.5 }} />

      <View style={{ flex: 1, minWidth: 0, paddingVertical: 8, paddingHorizontal: 10 }}>
        <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '700', color: tokens.color.ink }}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={{ fontSize: 11, color: tokens.color.sub, marginTop: 1 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {right != null && <View style={{ paddingRight: 10 }}>{right}</View>}

      {inkPercent != null && (
        <Animated.View
          testID="rail-live-ink"
          style={{
            position: 'absolute',
            left: 53.5,
            bottom: -1,
            height: 2,
            borderRadius: 2,
            backgroundColor: tokens.color.indigo,
            width: inkWidth(ink, inkPercent),
          }}
        />
      )}
    </View>
  );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * THE TICK — the pitch's `.tick`, a checkmark that STROKES ITSELF ON rather
 * than appearing. A tick is the mark a person makes; drawing it is the app
 * saying "this was ticked off", which is a different statement from "this is
 * ticked". It is why a tick is worth animating and a checkbox glyph is not.
 *
 * `strokeDashoffset` is not a transform, so this gesture can never use the
 * native driver (see `motion.ts`).
 */
export function Tick({ size = 12, drawn = true }: { size?: number; drawn?: boolean }) {
  const tokens = useTokens();
  const v = useGesture(drawn, DUR.tick, { native: false });
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <AnimatedPath
        d="M4 12.5 L10 18 L20 6"
        fill="none"
        stroke={tokens.color.green}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={DASH.tick}
        strokeDashoffset={strokeDashoffset(v, DASH.tick) as unknown as number}
      />
    </Svg>
  );
}

/** The small right-hand status word on a rail row (`.rowln .st`). */
export function RailStatus({ tone, children }: PropsWithChildren<{ tone: 'good' | 'now' | 'muted' }>) {
  const tokens = useTokens();
  const color =
    tone === 'good' ? tokens.color.green : tone === 'now' ? tokens.color.late : tokens.color.sub;
  return <Text style={{ fontSize: 11, fontWeight: '700', color }}>{children}</Text>;
}

function pillTones(tokens: { color: ColorPalette }) {
  return {
    green: { bg: tokens.color.green50, fg: tokens.color.green },
    red: { bg: tokens.color.red50, fg: tokens.color.red },
    // `late` (not `amber`) — a deep gold distinct from the brand accent,
    // matching the web's `--sk-late`; readable text on the amber tint bg in
    // both schemes.
    amber: { bg: tokens.color.amber50, fg: tokens.color.late },
    indigo: { bg: tokens.color.indigo50, fg: tokens.color.indigo },
    neutral: { bg: tokens.color.surfaceMuted, fg: tokens.color.sub },
  } as const;
}

export function Pill({ tone, children }: PropsWithChildren<{ tone: keyof ReturnType<typeof pillTones> }>) {
  const tokens = useTokens();
  const tones = pillTones(tokens);
  // Defensive fallback: `tone` is typed to a known key, but a caller can
  // still hand this an untrusted/unvalidated string at runtime (e.g.
  // `Holiday.type`, which is a plain DB string with no enum, only
  // `@IsIn`-validated at write time — see holidays.tsx). Falling back to
  // 'neutral' instead of crashing on `t.bg`/`t.fg` keeps one bad value from
  // taking down the whole screen.
  const t = tones[tone] ?? tones.neutral;
  return (
    <View style={{ backgroundColor: t.bg, borderRadius: tokens.radius.chip,
      paddingHorizontal: 11, paddingVertical: 5, alignSelf: 'flex-start' }}>
      <Text style={{ color: t.fg, fontSize: 11, fontWeight: '700' }}>{children}</Text>
    </View>
  );
}

function toastTones(tokens: { color: ColorPalette }) {
  return {
    success: { bg: tokens.color.green50, fg: tokens.color.green },
    error: { bg: tokens.color.red50, fg: tokens.color.red },
    // A save that's queued on the device but not yet on the server is
    // neither success nor error — indigo (the brand accent, not green/red)
    // keeps it visually distinct from both. Used by the offline attendance
    // save queue (see src/lib/offline-queue.ts).
    pending: { bg: tokens.color.indigo50, fg: tokens.color.indigo },
  } as const;
}

// Inline confirmation/error banner — the RN equivalent of the web's `sonner`
// toast. There is no toast library in this app, and a global overlay host
// would have to survive navigation transitions to be reliable; rendering it
// in place on the screen that owns the result is simpler and means the
// message is guaranteed visible before anything happens (the caller decides
// whether/when to navigate, e.g. from `actionLabel`'s `onAction`). Shared
// here, not inlined in one screen, because more than one flow in this app
// needs the same "it worked / here's why it didn't" banner.
//
// Skinned as the pitch's `.resetok` — a tinted slip OUTLINED in its own ink
// (`border:1.5px solid var(--good); background:var(--good-tint);
// border-radius:11px`) — rather than as the pitch's `.toast`, which is a
// solid `--ink` overlay. The overlay is transient and can afford to be one
// colour for everything; this banner stays on the page, so success and
// failure have to be distinguishable at a glance without being read.
export function Toast({
  kind,
  message,
  actionLabel,
  onAction,
  testID,
}: {
  kind: keyof ReturnType<typeof toastTones>;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}) {
  const tokens = useTokens();
  const tone = toastTones(tokens)[kind];
  const id = testID ?? `toast-${kind}`;
  return (
    <View
      testID={id}
      style={{
        backgroundColor: tone.bg,
        borderColor: tone.fg,
        borderWidth: 1.5,
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Text style={{ flex: 1, color: tone.fg, fontWeight: '600', fontSize: 13 }}>{message}</Text>
      {actionLabel && onAction && (
        <Pressable onPress={onAction} testID={`${id}-action`}>
          <Text style={{ color: tone.fg, fontWeight: '700', fontSize: 13 }}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}
