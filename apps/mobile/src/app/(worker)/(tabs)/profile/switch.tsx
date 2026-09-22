import { Text, View } from 'react-native';
import { ProfileSwitcher } from '@/components/ProfileSwitcher';
import { Card, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';

/**
 * SWITCH PROFILE — a teacher who is also a parent, or who teaches at two
 * schools, opens the other profile from here. The list comes from the
 * phone number on the login; when it opens nothing else, the page says so.
 */
export default function WorkerSwitch() {
  const tokens = useTokens();
  return (
    <Screen>
      <SectionTitle title="Switch profile" />
      <Card>
        <View style={{ padding: 12, gap: 8 }}>
          <Text style={{ fontSize: 12.5, lineHeight: 18, color: tokens.color.ink2 }}>
            Every profile your phone number opens — your children's diaries, or another school you teach at. Each keeps its own login; switching never mixes them.
          </Text>
        </View>
      </Card>
      <ProfileSwitcher />
      <Text style={{ fontSize: 12, color: tokens.color.sub, paddingHorizontal: 4 }}>
        Nothing listed? Then this number opens only this profile. A number is linked at the school office, or under My WhatsApp number.
      </Text>
    </Screen>
  );
}
