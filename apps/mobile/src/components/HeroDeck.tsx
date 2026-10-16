import { Pressable, Text, View } from 'react-native';
import type { IconName } from './icons';
import { useTheme, useTokens } from '@/theme/theme-context';
import { accentFill, useFamilies, type Family } from '@/theme/families';
import { brand } from '@/theme/tokens';

/**
 * THE SHEET (direction C, 16 Oct 2026). A role's Home no longer opens with a
 * coloured slab holding four things. The colour is a BAND behind the greeting
 * (Screen `band`); the hero is a white SHEET that overlaps it and carries one
 * headline, one line, up to three figures on family-tinted cells, and the one
 * filled button. Quick actions are gone from here: the tool grid is the only
 * place a door lives, so nothing on Home appears twice.
 */
export interface HeroFigure {
  value: string;
  label: string;
  testID?: string;
  /** Optional: a figure that opens its list. */
  onPress?: () => void;
  /** Which kind of work the number belongs to; the cell takes that tint. Default: the accent. */
  family?: Family;
  /** A state, when the number is a verdict: present/done, pending, overdue. Beats `family`. */
  tone?: 'good' | 'warn' | 'bad';
}
/** Kept for callers' types; the deck no longer draws actions (they live in the tool grid). */
export interface HeroAction {
  label: string;
  icon: IconName;
  onPress: () => void;
  testID?: string;
  badge?: number;
}

export function HeroDeck({ figures = [] }: { figures?: HeroFigure[]; actions?: HeroAction[] }) {
  const tokens = useTokens();
  const fam = useFamilies();
  if (!figures.length) return null;
  const c = tokens.color;
  const toneOf = (f: HeroFigure): { bg: string; ink: string } => {
    if (f.tone === 'good') return { bg: c.green50, ink: c.green };
    if (f.tone === 'warn') return { bg: c.amber50, ink: c.late };
    if (f.tone === 'bad') return { bg: c.red50, ink: c.red };
    const t = fam[f.family ?? 'learn'];
    return { bg: t.soft, ink: t.ink };
  };
  return (
    <View testID="hero-figures" style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
      {figures.slice(0, 3).map((f) => {
        const t = toneOf(f);
        return (
          <Pressable
            key={f.label}
            testID={f.testID}
            disabled={!f.onPress}
            onPress={f.onPress}
            accessibilityRole={f.onPress ? 'button' : undefined}
            accessibilityLabel={`${f.label}, ${f.value}`}
            style={({ pressed }) => ({ flex: 1, minWidth: 0, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: t.bg, opacity: pressed ? 0.8 : 1 })}
          >
            <Text numberOfLines={1} style={{ color: t.ink, fontSize: 19, lineHeight: 23, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
              {f.value}
            </Text>
            <Text numberOfLines={1} style={{ color: t.ink, opacity: 0.9, fontSize: 12, lineHeight: 16, marginTop: 2 }}>
              {f.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The sheet's own shape, for heroes that draw their own content (NowCard, StudentHero). */
export function sheetStyle(c: { surface: string; line: string }, padding = 20) {
  return {
    borderRadius: 28,
    padding,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.line,
    shadowColor: brand.hero.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  } as const;
}

/**
 * A role's sheet for the desk homes: eyebrow, the one headline, a line, the
 * optional main action (the only filled button on the screen) and the
 * figures. `quiet` keeps the eyebrow calm when nothing is waiting.
 */
export function RoleHero({
  eyebrow,
  title,
  line,
  primary,
  figures,
  testID = 'role-hero',
  quiet,
  titleTestID,
}: {
  eyebrow: string;
  title: string;
  line?: string;
  primary?: { label: string; onPress: () => void; testID?: string };
  figures?: HeroFigure[];
  /** Accepted for callers that still pass them; nothing is drawn (the tool grid is the one place). */
  actions?: HeroAction[];
  testID?: string;
  quiet?: boolean;
  titleTestID?: string;
}) {
  const tokens = useTokens();
  const { scheme } = useTheme();
  const c = tokens.color;
  const fill = accentFill(c, scheme);
  return (
    <View testID={testID} style={sheetStyle(c)}>
      <Text style={{ color: quiet ? c.sub : c.indigo, fontSize: 12, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' }}>{eyebrow}</Text>
      <Text testID={titleTestID} style={{ color: c.ink, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.3, marginTop: 6 }}>{title}</Text>
      {line ? <Text style={{ color: c.ink2, fontSize: 14, lineHeight: 20, marginTop: 4 }}>{line}</Text> : null}
      <HeroDeck figures={figures} />
      {primary ? (
        <Pressable
          testID={primary.testID}
          accessibilityRole="button"
          onPress={primary.onPress}
          style={({ pressed }) => ({ marginTop: 16, minHeight: 48, borderRadius: 24, backgroundColor: fill.bg, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}
        >
          <Text style={{ color: fill.fg, fontWeight: '700', fontSize: 15 }}>{primary.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
