import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Icon, type IconName } from './icons';
import { useTheme, useTokens } from '@/theme/theme-context';
import { heroStops } from '@/theme/families';
import { brand } from '@/theme/tokens';

/**
 * THE HERO DECK (user, 9 Oct 2026: "this main tile can be big & more
 * informative & can contain more quick actions for each role").
 *
 * Sits at the bottom of a role's hero card, always on the accent gradient:
 *   figures — up to three numbers that answer "how is my day going", each in
 *             a soft white panel (value 20/700, label 12);
 *   actions — up to four round 48 dp buttons with a word under each, the
 *             things this role does most from Home.
 * White ink only: heroStops() guarantees 4.5:1 for white in both schemes.
 */
export interface HeroFigure {
  value: string;
  label: string;
  testID?: string;
  /** Optional: a figure that opens its list. */
  onPress?: () => void;
}
export interface HeroAction {
  label: string;
  icon: IconName;
  onPress: () => void;
  testID?: string;
  /** A small count on the button (unread, waiting). */
  badge?: number;
}

const ON = brand.onHero;

export function HeroDeck({ figures = [], actions = [] }: { figures?: HeroFigure[]; actions?: HeroAction[] }) {
  const tokens = useTokens();
  if (!figures.length && !actions.length) return null;
  return (
    <View style={{ gap: 16, marginTop: 16 }}>
      {figures.length > 0 && (
        <View testID="hero-figures" style={{ flexDirection: 'row', gap: 8 }}>
          {figures.slice(0, 3).map((f) => (
            <Pressable
              key={f.label}
              testID={f.testID}
              disabled={!f.onPress}
              onPress={f.onPress}
              accessibilityRole={f.onPress ? 'button' : undefined}
              accessibilityLabel={`${f.label}, ${f.value}`}
              style={{ flex: 1, minWidth: 0, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.14)' }}
            >
              <Text numberOfLines={1} style={{ color: ON, fontSize: 20, lineHeight: 24, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                {f.value}
              </Text>
              <Text numberOfLines={1} style={{ color: ON, opacity: 0.85, fontSize: 12, lineHeight: 16, marginTop: 2 }}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {actions.length > 0 && (
        <View testID="hero-actions" style={{ flexDirection: 'row' }}>
          {actions.slice(0, 4).map((a) => (
            <Pressable
              key={a.label}
              testID={a.testID}
              accessibilityRole="button"
              accessibilityLabel={a.badge ? `${a.label}, ${a.badge} waiting` : a.label}
              onPress={a.onPress}
              style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 6, opacity: pressed ? 0.7 : 1 })}
            >
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  backgroundColor: 'rgba(255,255,255,0.18)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.28)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name={a.icon} size={22} color={ON} fillOpacity={0.25} />
                {a.badge ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: -4,
                      right: -4,
                      minWidth: 18,
                      height: 18,
                      borderRadius: 9,
                      paddingHorizontal: 4,
                      backgroundColor: tokens.color.red,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: ON, fontSize: 10, fontWeight: '800' }}>{a.badge > 9 ? '9+' : a.badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ color: ON, fontSize: 12, fontWeight: '600' }}>
                {a.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * A role's hero card for the desk homes that had none (accounts, library,
 * sports, office): the accent gradient, an eyebrow, the one headline, a line,
 * an optional main action, then the deck.
 */
export function RoleHero({
  eyebrow,
  title,
  line,
  primary,
  figures,
  actions,
  testID = 'role-hero',
  quiet,
  titleTestID,
}: {
  eyebrow: string;
  title: string;
  line?: string;
  primary?: { label: string; onPress: () => void; testID?: string };
  figures?: HeroFigure[];
  actions?: HeroAction[];
  testID?: string;
  /** The deep shade, for a calm state (nothing waiting). */
  quiet?: boolean;
  titleTestID?: string;
}) {
  const tokens = useTokens();
  const { scheme } = useTheme();
  const stops = heroStops(tokens.color, scheme, quiet ? 'quiet' : 'live');
  const [size, setSize] = useState({ w: 0, h: 0 });
  return (
    <View
      testID={testID}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
      }}
      style={{ borderRadius: 28, padding: 20, overflow: 'hidden', backgroundColor: stops[0] }}
    >
      {size.w > 0 && (
        <Svg width={size.w} height={size.h} style={{ position: 'absolute', top: 0, left: 0 }} pointerEvents="none">
          <Defs>
            <LinearGradient id={`${testID}-g`} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={stops[0]} />
              <Stop offset="1" stopColor={stops[1]} />
            </LinearGradient>
          </Defs>
          <Rect width={size.w} height={size.h} fill={`url(#${testID}-g)`} />
        </Svg>
      )}
      <Text style={{ color: ON, opacity: 0.9, fontSize: 12, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' }}>{eyebrow}</Text>
      <Text testID={titleTestID} style={{ color: ON, fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.3, marginTop: 6 }}>{title}</Text>
      {line ? <Text style={{ color: ON, opacity: 0.9, fontSize: 14, lineHeight: 20, marginTop: 4 }}>{line}</Text> : null}
      {primary ? (
        <Pressable
          testID={primary.testID}
          accessibilityRole="button"
          onPress={primary.onPress}
          style={({ pressed }) => ({ marginTop: 16, minHeight: 48, borderRadius: 24, backgroundColor: ON, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}
        >
          <Text style={{ color: stops[1], fontWeight: '700', fontSize: 15 }}>{primary.label}</Text>
        </Pressable>
      ) : null}
      <HeroDeck figures={figures} actions={actions} />
    </View>
  );
}

