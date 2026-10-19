import { Text, View } from 'react-native';
import { Touchable } from './Touchable';
import { Icon, isIconName } from './icons';
import { useTheme, useTokens } from '@/theme/theme-context';
import { badgeColours, toneFamily, useFamilyTone } from '@/theme/families';

/** One job a person starts from Home in a tap. */
export interface QuickAction {
  /** A verb phrase, never a place: "Take register", "Set homework". */
  label: string;
  icon: string;
  onPress: () => void;
  /** 'amber' only when someone is waiting on you (sckools-ui-standards §3c). */
  tone?: 'amber';
  /** A count worth interrupting for; 0 and undefined draw nothing. */
  badge?: number;
  testID?: string;
}

/**
 * QUICK ACTIONS (user, 19 Oct 2026: "remove these rings completely, add quick
 * actions instead below the first panel").
 *
 * Four jobs, two by two, straight under the sheet. They are drawn as BUTTONS
 * — an icon tile and a verb in one 60 dp bar — so they can never be mistaken
 * for the menu's tiles below, which are places. A job that lives here is not
 * drawn again in the menu (one door per thing: ui-mistake-ledger
 * home-split-into-two-menus).
 *
 * Anatomy: 12 dp gaps; each bar r20, surface + 1 dp line, 12 dp inner padding,
 * 36 dp icon tile r12 in the job's own family tint, label 14/600 ink on up to
 * two lines; a red count on the tile's corner.
 */
export function QuickActions({
  actions,
  testID = 'quick-actions',
}: {
  actions: QuickAction[];
  testID?: string;
}) {
  const tokens = useTokens();
  const c = tokens.color;
  const { scheme } = useTheme();
  const familyTone = useFamilyTone();
  if (actions.length === 0) return null;
  return (
    <View
      testID={testID}
      accessibilityRole="toolbar"
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}
    >
      {actions.map((a) => {
        const t = a.tone ? toneFamily(a.tone, c, scheme) : familyTone(a.icon);
        const badge = a.badge && a.badge > 0 ? a.badge : undefined;
        return (
          // The half-width lives on a plain View: Touchable puts its style on an
          // inner view, so a basis given to it never sized the button (the
          // labels collapsed to nothing on the first build, 19 Oct 2026).
          <View key={a.label} style={{ width: '48%', flexGrow: 1 }}>
            <Touchable
              testID={a.testID ?? `quick-${a.label}`}
              accessibilityRole="button"
              accessibilityLabel={badge ? `${a.label}, ${badge} waiting` : a.label}
              haptic="light"
              onPress={a.onPress}
              style={{
                minHeight: 60,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 20,
                backgroundColor: c.surface,
                borderWidth: 1,
                borderColor: c.line,
              }}
            >
              <View>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 12,
                    backgroundColor: t.soft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isIconName(a.icon) && (
                    <Icon name={a.icon} size={20} color={t.ink} fillOpacity={0.18} />
                  )}
                </View>
                {badge !== undefined && (
                  <View
                    testID={`quick-badge-${a.label}`}
                    style={{
                      position: 'absolute',
                      top: -5,
                      right: -5,
                      minWidth: 18,
                      height: 18,
                      borderRadius: 9,
                      paddingHorizontal: 5,
                      backgroundColor: badgeColours(c).bg,
                      borderWidth: 2,
                      borderColor: c.surface,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      maxFontSizeMultiplier={1.2}
                      style={{ color: badgeColours(c).fg, fontSize: 10, fontWeight: '800' }}
                    >
                      {badge > 9 ? '9+' : badge}
                    </Text>
                  </View>
                )}
              </View>
              <Text
                numberOfLines={2}
                maxFontSizeMultiplier={1.3}
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 14,
                  lineHeight: 18,
                  fontWeight: '600',
                  color: c.ink,
                }}
              >
                {a.label}
              </Text>
            </Touchable>
          </View>
        );
      })}
    </View>
  );
}
