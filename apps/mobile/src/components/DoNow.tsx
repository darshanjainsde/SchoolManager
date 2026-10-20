import { Text, View } from 'react-native';
import { Touchable } from './Touchable';
import { Icon, isIconName } from './icons';
import { useTheme, useTokens } from '@/theme/theme-context';
import { toneFamily, useFamilyTone } from '@/theme/families';

/** One thing the person can finish from Home in a tap. */
export interface DoNowItem {
  /** Stable key, also the test id suffix (`donow-${key}`). */
  key: string;
  /** A duotone glyph from components/icons.tsx. */
  icon: string;
  /** What to do, verb first: "Take V-C register". */
  title: string;
  /** One quiet line of where/when: "English · 09:30–10:15". */
  line: string;
  /** The button's one word: Take, Reply, Open, Update. */
  verb: string;
  /** 'amber' only when someone is waiting on you (sckools-ui-standards §3c). */
  tone?: 'amber';
  onPress: () => void;
}

/** How many rows Home shows; the rest are one tap away in the menu. */
export const DO_NOW_MAX = 4;

/**
 * DO NOW (user, 19 Oct 2026: "more direct actions in homepage itself").
 *
 * The few things that are waiting on this person today, each finished from
 * here in ONE tap — a row is the whole target, the pill on its right says the
 * verb. Built only from real state (an open register, unread messages, new
 * concerns, a class to mark on the syllabus); when nothing waits, the card is
 * not drawn at all rather than saying "nothing to do".
 *
 * Anatomy (sckools-ui-standards §1/§3): r24 card, 20 dp side padding so its
 * text starts on the same line as the sheet and the menu; 64 dp rows, 36 dp
 * icon tile r12, title 15/600, line 13 `sub`; dividers inset to the text; the
 * pill is tonal in the row's own tile colours (never filled: the sheet owns
 * the one filled button).
 */
export function DoNow({ items, testID = 'donow' }: { items: DoNowItem[]; testID?: string }) {
  const tokens = useTokens();
  const c = tokens.color;
  const { scheme } = useTheme();
  const familyTone = useFamilyTone();
  const rows = items.slice(0, DO_NOW_MAX);
  if (rows.length === 0) return null;
  return (
    <View testID={testID} style={{ backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: c.line, paddingTop: 16, paddingBottom: 6 }}>
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ marginHorizontal: 20, marginBottom: 4, fontSize: 13, fontWeight: '700', color: c.sub, letterSpacing: 0.2 }}>
        Do now
      </Text>
      {rows.map((it, i) => {
        const t = it.tone ? toneFamily(it.tone, c, scheme) : familyTone(it.icon);
        return (
          <Touchable
            key={it.key}
            testID={`donow-${it.key}`}
            accessibilityRole="button"
            accessibilityLabel={`${it.title}. ${it.line}. ${it.verb}`}
            haptic="light"
            onPress={it.onPress}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingHorizontal: 20, gap: 12 }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: t.soft, alignItems: 'center', justifyContent: 'center' }}>
              {isIconName(it.icon) && <Icon name={it.icon} size={20} color={t.ink} fillOpacity={0.18} />}
            </View>
            <View
              style={{
                flex: 1,
                minWidth: 0,
                alignSelf: 'stretch',
                justifyContent: 'center',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                // The hairline starts at the text, never under the icon (§3).
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: c.line,
              }}
            >
              <View style={{ flex: 1, minWidth: 0, paddingVertical: 10 }}>
                <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize: 15, lineHeight: 20, fontWeight: '600', color: c.ink }}>
                  {it.title}
                </Text>
                <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontSize: 13, lineHeight: 18, color: c.sub, marginTop: 1 }}>
                  {it.line}
                </Text>
              </View>
              <View style={{ minWidth: 64, height: 34, borderRadius: 17, paddingHorizontal: 14, backgroundColor: t.soft, alignItems: 'center', justifyContent: 'center' }}>
                <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 13, fontWeight: '700', color: t.ink }}>
                  {it.verb}
                </Text>
              </View>
            </View>
          </Touchable>
        );
      })}
    </View>
  );
}
