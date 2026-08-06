import { Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card, Screen } from '@/components/ui';
import { AppearanceSetting } from '@/components/AppearanceSetting';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/**
 * SETTINGS, SHARED BY BOTH PORTALS.
 *
 * Everything here is about how the app LOOKS to this person on this device —
 * nothing account-shaped, which lives on Profile alongside sign-out. Keeping
 * the two apart is why this is a screen rather than another block on Profile:
 * a person hunting for the theme was scrolling past their own phone number to
 * find it.
 *
 * Rendered by a thin route file in each portal so both get the same screen
 * without either owning it.
 */
export function SettingsScreen({ portal }: { portal: 'staff' | 'family' }): React.JSX.Element {
  const tokens = useTokens();

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 2 }}>
        <Ionicons name="settings-outline" size={20} color={tokens.color.sub} />
        <Text
          maxFontSizeMultiplier={1.4}
          style={{ fontFamily: font.serif, fontSize: 24, color: tokens.color.ink }}
        >
          Settings
        </Text>
      </View>
      <Text style={{ marginHorizontal: 4, marginTop: -2, fontSize: 12, color: tokens.color.sub }}>
        These choices are yours and stay on this device.
      </Text>

      <Card>
        <AppearanceSetting />
      </Card>

      {/* Says what the DEFAULT means, so "My school" is understood as a real
          choice rather than a placeholder somebody has to decode. */}
      <Text
        testID={`settings-brand-note-${portal}`}
        style={{ marginHorizontal: 6, fontSize: 11.5, color: tokens.color.sub, lineHeight: 17 }}
      >
        My school follows your school’s own colour. Pick another and it stays, in both light and
        dark.
      </Text>
    </Screen>
  );
}
