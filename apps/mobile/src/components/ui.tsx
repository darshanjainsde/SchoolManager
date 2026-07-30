import type { PropsWithChildren } from 'react';
import { Pressable, ScrollView, Text, View, type ViewStyle } from 'react-native';
import { tokens } from '@/theme/tokens';

export function Screen({ children }: PropsWithChildren) {
  return (
    <ScrollView
      testID="screen-scroll"
      style={{ flex: 1, backgroundColor: tokens.color.appBg }}
      contentContainerStyle={{ padding: 14, gap: tokens.gap, paddingBottom: 28 }}
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  return (
    <View style={[{ backgroundColor: tokens.color.surface, borderColor: tokens.color.line,
      borderWidth: 1, borderRadius: tokens.radius.card, padding: 14 }, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({ title, actionLabel, onAction }:
  { title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      marginHorizontal: 4, marginTop: 6, marginBottom: -3 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>{title}</Text>
      {actionLabel && (
        <Pressable onPress={onAction}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: tokens.color.indigo }}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const pillTones = {
  green: { bg: tokens.color.green50, fg: tokens.color.green },
  red: { bg: tokens.color.red50, fg: tokens.color.red },
  amber: { bg: tokens.color.amber50, fg: '#B45309' },
  indigo: { bg: tokens.color.indigo50, fg: tokens.color.indigo },
  neutral: { bg: '#F1F3F7', fg: tokens.color.sub },
} as const;

export function Pill({ tone, children }: PropsWithChildren<{ tone: keyof typeof pillTones }>) {
  // Defensive fallback: `tone` is typed to a known key, but a caller can
  // still hand this an untrusted/unvalidated string at runtime (e.g.
  // `Holiday.type`, which is a plain DB string with no enum, only
  // `@IsIn`-validated at write time — see holidays.tsx). Falling back to
  // 'neutral' instead of crashing on `t.bg`/`t.fg` keeps one bad value from
  // taking down the whole screen.
  const t = pillTones[tone] ?? pillTones.neutral;
  return (
    <View style={{ backgroundColor: t.bg, borderRadius: tokens.radius.chip,
      paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ color: t.fg, fontSize: 11, fontWeight: '700' }}>{children}</Text>
    </View>
  );
}

const toastTones = {
  success: { bg: tokens.color.green50, fg: tokens.color.green },
  error: { bg: tokens.color.red50, fg: tokens.color.red },
} as const;

// Inline confirmation/error banner — the RN equivalent of the web's `sonner`
// toast. There is no toast library in this app, and a global overlay host
// would have to survive navigation transitions to be reliable; rendering it
// in place on the screen that owns the result is simpler and means the
// message is guaranteed visible before anything happens (the caller decides
// whether/when to navigate, e.g. from `actionLabel`'s `onAction`). Shared
// here, not inlined in one screen, because more than one flow in this app
// needs the same "it worked / here's why it didn't" banner.
export function Toast({
  kind,
  message,
  actionLabel,
  onAction,
  testID,
}: {
  kind: keyof typeof toastTones;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}) {
  const tone = toastTones[kind];
  const id = testID ?? `toast-${kind}`;
  return (
    <View
      testID={id}
      style={{
        backgroundColor: tone.bg,
        borderRadius: tokens.radius.card,
        padding: 14,
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
