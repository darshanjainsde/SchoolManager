import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { font } from '@/theme/tokens';
import { useTokens } from '@/theme/theme-context';
import { onBand } from '@/theme/families';

/** How tall the band behind a Home's greeting is, before the sheet overlaps it (sckools-ui-standards §3c). */
// 168 (19 Oct 2026): the sheets lost their figure rows, so at 236 the band ran
// out BELOW a short sheet and cut through the quick actions. 168 ends about
// 70 dp into the sheet, so the band always stops behind it.
export const BAND_HEIGHT = 168;

/**
 * THE GREETING ON THE BAND (direction C, 16 Oct 2026). Every role Home opens
 * the same way: a small tracked eyebrow (the date), the
 * NAME as a title, one line of fact, and whatever sits in the right margin
 * (the bell). White ink only: the band's stops are pushed to 4.5:1 for white
 * in both schemes (theme/families.ts heroStops), so nothing here needs a check.
 */
export function BandGreeting({
  eyebrow,
  title,
  line,
  right,
  titleTestID,
  testID = 'band-greeting',
}: {
  eyebrow?: string;
  title: string;
  line?: string;
  right?: ReactNode;
  titleTestID?: string;
  testID?: string;
}) {
  // White on an ink band, dark brand ink on a lit one (Ink & Lit, 19 Oct 2026).
  const on = onBand(useTokens().color);
  const greeting = (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        {eyebrow ? (
          <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: on, opacity: 0.82, marginBottom: 1 }}>
            {eyebrow}
          </Text>
        ) : null}
        <Text
          testID={titleTestID}
          maxFontSizeMultiplier={1.4}
          numberOfLines={1}
          style={{ fontFamily: font.serif, fontSize: 26, lineHeight: 31, fontWeight: '700', letterSpacing: -0.4, color: on }}
        >
          {title}
        </Text>
        {line ? (
          <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={{ marginTop: 3, fontSize: 12.5, lineHeight: 17, color: on, opacity: 0.88 }}>
            {line}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
  return greeting;
}
