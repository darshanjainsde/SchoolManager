import { useRef, type PropsWithChildren, type ReactNode } from 'react';
import { Animated, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type ViewStyle, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useSegments } from 'expo-router';
import { ApiError } from '@/lib/api';
import { useTokens } from '@/theme/theme-context';
import { font, type ColorPalette } from '@/theme/tokens';
import { DASH, DUR, inkWidth, strokeDashoffset, useGesture } from '@/theme/motion';
import { isPushedRoute, titleForSegments } from '@/lib/screen-titles';
import { BackChipHeader } from './BackChipHeader';
import { Icon, type IconName } from './icons';

/**
 * THE LIST FORM OF `Screen`. Same chrome — top inset, back chip, the school's
 * own pull-to-refresh, the keyboard rule — but a `FlatList` at the root, so a
 * long list mounts only what is on screen.
 *
 * It exists because `Screen` IS a ScrollView: a `FlatList` inside one is not
 * virtualised at all (React Native says so, loudly), and every list in this
 * app used to be a `.map` inside `Screen` — a notification list, a message
 * transcript and a month of diary all mounted every row (perf audit
 * 2026-09-22, #3). Use this wherever the row count is set by the school's
 * data rather than by the design; keep `Screen` for a page of cards.
 */
export function ListScreen<T>({
  data,
  renderItem,
  keyExtractor,
  header,
  footer,
  empty,
  onRefresh,
  refreshing = false,
  itemHeight,
  testID = 'screen-list',
}: {
  data: readonly T[];
  renderItem: (item: T, index: number) => React.ReactElement | null;
  keyExtractor: (item: T, index: number) => string;
  header?: ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Fixed-height rows can skip measurement entirely — pass it when they are. */
  itemHeight?: number;
  testID?: string;
}) {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const segments: string[] = typeof useSegments === 'function' ? useSegments() : [];
  const pushed = isPushedRoute(segments);
  const list = (
    <FlatList
      testID={testID}
      data={data as T[]}
      renderItem={({ item, index }) => renderItem(item, index)}
      keyExtractor={keyExtractor}
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: tokens.color.appBg }}
      ListHeaderComponent={header ? <>{header}</> : undefined}
      ListFooterComponent={footer ? <>{footer}</> : undefined}
      ListEmptyComponent={empty ? <>{empty}</> : undefined}
      ItemSeparatorComponent={() => <View style={{ height: tokens.gap }} />}
      // Windowing: enough rows above and below that a fast scroll never
      // shows a blank band, few enough that a 500-row list is cheap.
      initialNumToRender={12}
      windowSize={9}
      maxToRenderPerBatch={10}
      removeClippedSubviews
      getItemLayout={
        itemHeight
          ? (_d, index) => ({ length: itemHeight, offset: itemHeight * index, index })
          : undefined
      }
      refreshControl={
        onRefresh ? (
          <RefreshControl
            testID="screen-refresh"
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={tokens.color.indigo}
            colors={[tokens.color.indigo]}
            progressBackgroundColor={tokens.color.surface}
          />
        ) : undefined
      }
      contentContainerStyle={{
        paddingTop: pushed ? 4 : insets.top + 10,
        paddingHorizontal: 14,
        paddingBottom: 28,
        flexGrow: 1,
      }}
    />
  );
  if (!pushed) return list;
  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.appBg }}>
      <BackChipHeader title={titleForSegments(segments)} />
      {list}
    </View>
  );
}

export function Screen({
  children,
  onRefresh,
  refreshing = false,
}: PropsWithChildren<{
  /**
   * Pull-to-refresh. The gesture everyone tries first, which until now did
   * nothing — a screen that reloads on focus still looks stuck when you are
   * staring at it waiting for a colleague's mark to appear.
   *
   * Optional: a screen with no cheap way to reload simply omits it, and gets
   * no spinner to pull rather than one that lies.
   */
  onRefresh?: () => void;
  refreshing?: boolean;
}>) {
  const tokens = useTokens();
  // Top safe-area inset (Phase 5·0b): with headerShown:false the tab
  // navigator renders from the very top of the display, so without this the
  // first line of every screen ("Hi, {name}") sits under the status bar on
  // real devices. One fix here covers every screen; the tab bar's bottom
  // inset is handled by the navigator's own `insets` prop.
  const insets = useSafeAreaInsets();
  // Pitch №5 §3: a pushed screen carries the back chip header, which then
  // owns the top inset. Positional, so no screen has to ask for it — see
  // `isPushedRoute`. Most test suites stub expo-router without `useSegments`;
  // for them the guard resolves to "not pushed", which is also what they
  // rendered before the chip existed.
  const segments: string[] = typeof useSegments === 'function' ? useSegments() : [];
  const pushed = isPushedRoute(segments);
  const scroll = (
    <ScrollView
      testID="screen-scroll"
      // While an input is focused RN's default swallows the next tap to
      // dismiss the keyboard — a teacher entering 40 marks tapped 80 times,
      // a parent's "Sign" button "did not work" (UI audit 2026-09-22, #1).
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: tokens.color.appBg }}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            testID="screen-refresh"
            refreshing={refreshing}
            onRefresh={onRefresh}
            // The school's own colour on the spinner, so even the reload
            // belongs to the school rather than to the platform.
            tintColor={tokens.color.indigo}
            colors={[tokens.color.indigo]}
            progressBackgroundColor={tokens.color.surface}
          />
        ) : undefined
      }
      contentContainerStyle={{
        paddingTop: pushed ? 4 : insets.top + 10,
        paddingHorizontal: 14,
        gap: tokens.gap,
        paddingBottom: 28,
      }}
    >
      {children}
    </ScrollView>
  );
  if (!pushed) return scroll;
  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.appBg }}>
      <BackChipHeader title={titleForSegments(segments)} />
      {scroll}
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
        <Pressable onPress={onAction}
          accessibilityRole="button"
          >
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
export function Empty({
  children,
  testID,
  /**
   * A duotone glyph drawn faintly above the line. Not decoration: an empty
   * screen is the one screen with nothing on it to say WHICH screen it is, so
   * a page reached by mistake reads as "no messages" rather than as a page
   * that failed to load. Left off where the surrounding page already names
   * itself unmistakably.
   */
  icon,
}: PropsWithChildren<{ testID?: string; icon?: IconName }>) {
  const tokens = useTokens();
  return (
    <View testID={testID} style={{ paddingVertical: 20, paddingHorizontal: 14, alignItems: 'center', gap: 9 }}>
      {icon && (
        // Faint on purpose — it sits behind the sentence in the reading order,
        // and an empty state that shouts is worse than one that waits.
        <Icon name={icon} size={26} color={tokens.color.line2} fillOpacity={0.5} />
      )}
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
   * The pitch writes its page titles with a glyph before the words. It is a
   * SEPARATE node here so the heading's own words stay one exact, matchable
   * string, and — second edition — it is a DRAWN duotone glyph, never an
   * emoji: an emoji is painted by the OS in its own colours and read aloud
   * as part of the sentence.
   */
  icon?: IconName;
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
        {icon ? <Icon name={icon} size={15} color={tokens.color.ink2} /> : null}
        <Text
          style={{ fontFamily: font.serif, fontSize: 14, fontWeight: '600', color: tokens.color.ink, flex: 1 }}
          numberOfLines={1}
        >
          {title}
        </Text>
      </View>
      {actionLabel && (
        <Pressable testID={actionTestID} onPress={onAction} hitSlop={6}
          accessibilityRole="button"
          >
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
          minWidth: 52,
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
        <Pressable onPress={onAction} testID={`${id}-action`}
          accessibilityRole="button"
          >
          <Text style={{ color: tone.fg, fontWeight: '700', fontSize: 13 }}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * WHAT FAILURE LOOKS LIKE — written in the diary's own italic, like `Empty`,
 * so a page that could not load still reads as a page and not as a fault.
 *
 * Three sentences, decided by what actually went wrong: no signal (status 0
 * from `safeFetch`), a record that is not there (404), or the server having
 * a bad moment (everything else). The button is not optional: a screen that
 * says "something went wrong" and offers nothing is the screen a parent
 * gives up on. Every red-sentence Card this app used to render is this now.
 */
export function ErrorState({
  error,
  onRetry,
  testID = 'error-state',
}: {
  error: Error | string;
  onRetry?: () => void;
  testID?: string;
}) {
  const tokens = useTokens();
  const status = error instanceof ApiError ? error.status : -1;
  const message = typeof error === 'string' ? error : error.message;
  const offline = status === 0;
  const missing = status === 404;
  const headline = offline
    ? 'No signal right now.'
    : missing
      ? 'That isn’t here.'
      : 'The school server had a problem.';
  const detail = offline
    ? 'Nothing you have done is lost.'
    : missing
      ? 'It may have been taken down by the school.'
      : message;
  return (
    <Card testID={testID} style={{ alignItems: 'center', gap: 7, paddingVertical: 18 }}>
      <Icon name={offline ? 'offline' : 'notices'} size={26} color={tokens.color.line2} fillOpacity={0.5} />
      <Text
        style={{
          color: tokens.color.ink2,
          fontSize: 14,
          lineHeight: 20,
          fontStyle: 'italic',
          fontFamily: font.serif,
          textAlign: 'center',
        }}
      >
        {headline}
      </Text>
      {detail ? (
        <Text style={{ color: tokens.color.sub, fontSize: 12, textAlign: 'center', lineHeight: 17 }}>{detail}</Text>
      ) : null}
      {onRetry && (
        <Pressable
          testID={`${testID}-retry`}
          accessibilityRole="button"
          onPress={onRetry}
          hitSlop={6}
          style={({ pressed }) => ({
            marginTop: 6,
            paddingVertical: 8,
            paddingHorizontal: 18,
            minHeight: 36,
            borderRadius: tokens.radius.chip,
            borderWidth: 1,
            borderColor: tokens.color.indigo,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ color: tokens.color.indigo, fontWeight: '700', fontSize: 13 }}>Try again</Text>
        </Pressable>
      )}
    </Card>
  );
}

/**
 * A FIGURE — the mono big-number tile, shared. Was Home's private KpiTile;
 * fees ("You owe"), sports ("Best mark") and library ("Due in 3 days") all
 * wanted it. Figures are set in the mono face so a percentage and a mark out
 * of fifty line up as numbers, not as words.
 *
 * The number WRAPS. ₹2,25,77,600 at 17px is wider than a half-row on a
 * 390px phone; a figure that cannot wrap pushes the row sideways, which the
 * ledger names as a mistake we have shipped before.
 */
export function Figure({
  label,
  value,
  hint,
  tone,
  onPress,
  testID,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'warn' | 'bad';
  onPress?: () => void;
  testID?: string;
}) {
  const tokens = useTokens();
  const toneColor: Record<'good' | 'warn' | 'bad', string> = {
    good: tokens.color.green,
    warn: tokens.color.late,
    bad: tokens.color.red,
  };
  const tile = {
    flex: 1,
    minWidth: 0,
    backgroundColor: tokens.color.surface,
    borderColor: tokens.color.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  } as const;
  const body = (
    <>
      <Text style={{ fontSize: 10.5, fontWeight: '600', color: tokens.color.sub }}>{label}</Text>
      <Text
        style={{
          fontFamily: font.mono,
          fontSize: 17,
          fontWeight: '700',
          color: tone ? toneColor[tone] : tokens.color.ink,
          marginTop: 2,
        }}
      >
        {value}
      </Text>
      {hint && (
        <Text style={{ fontSize: 10, color: tokens.color.sub, marginTop: 1 }} numberOfLines={2}>
          {hint}
        </Text>
      )}
    </>
  );
  // A figure you cannot open is a figure, not a button.
  if (!onPress) return <View testID={testID} style={tile}>{body}</View>;
  // LAYOUT (`flex: 1`) on a plain wrapper, PAINT on the Pressable — its style
  // lands on an inner view, where flex would leave the row laying out a
  // content-sized Pressable (ledger: wrapper-style-prop-lands-on-inner-node).
  const { flex, minWidth, ...paint } = tile;
  return (
    <View style={{ flex, minWidth }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={hint ? `${label}, ${value}, ${hint}` : `${label}, ${value}`}
        onPress={onPress}
        style={({ pressed }) => [paint, { opacity: pressed ? 0.7 : 1 }]}
      >
        {body}
      </Pressable>
    </View>
  );
}
