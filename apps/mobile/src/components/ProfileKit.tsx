import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { EditableAvatar } from './EditableAvatar';
import { Icon, type IconName } from './icons';
import { useTheme, useTokens } from '@/theme/theme-context';
import { familyTone } from '@/theme/families';

/**
 * THE PROFILE RECIPE (sckools-ui-standards §6, approved 9 Oct 2026).
 *
 * One head, two kinds of row and one group, shared by the teacher, family and
 * desk profiles so the three portals cannot drift apart again:
 *   head  — 96 dp photo in a 3 dp brand ring with a 3 dp ground gap, the name
 *           20/700, ONE line saying who this is, an optional tonal action;
 *   group — a label 13/600 above an r24 surface card, rows inside it;
 *   InfoRow — a fact: 36 dp tinted square, label 13 `sub` above the value 16/500;
 *   LinkRow — a door: 56 dp, 36 dp square, label 16/500, chevron;
 *   SignOutRow — the same door in red, alone in its own card, at the end.
 * Dividers start at the text (16 + 36 + 12 = 64), never under the square.
 */

export const PROFILE_AVATAR = 96;

export function ProfileHead({
  photoUrl,
  initials,
  name,
  line,
  onUploaded,
  action,
  nameTestID,
}: {
  photoUrl?: string | null;
  initials: string;
  name: string;
  line?: string | null;
  /** Omit to show initials without the photo picker (desk staff have no photo endpoint). */
  onUploaded?: (url: string) => void;
  action?: ReactNode;
  nameTestID?: string;
}) {
  const tokens = useTokens();
  const c = tokens.color;
  return (
    <View style={{ alignItems: 'center', paddingTop: 8 }}>
      <View style={{ padding: 3, borderRadius: 999, backgroundColor: c.indigo }}>
        <View style={{ padding: 3, borderRadius: 999, backgroundColor: c.appBg }}>
          {onUploaded ? (
            <EditableAvatar size={PROFILE_AVATAR} photoUrl={photoUrl ?? null} initials={initials} onUploaded={onUploaded} />
          ) : (
            <View
              testID="profile-initials"
              style={{ width: PROFILE_AVATAR, height: PROFILE_AVATAR, borderRadius: 999, backgroundColor: c.indigo50, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: 30, fontWeight: '700', color: c.indigo }}>{initials}</Text>
            </View>
          )}
        </View>
      </View>
      <Text
        testID={nameTestID}
        numberOfLines={2}
        style={{ fontSize: 20, lineHeight: 28, fontWeight: '700', color: c.ink, marginTop: 12, textAlign: 'center' }}
      >
        {name}
      </Text>
      {line ? (
        <Text style={{ fontSize: 14, lineHeight: 20, color: c.sub, marginTop: 2, textAlign: 'center' }}>{line}</Text>
      ) : null}
      {action ? <View style={{ marginTop: 16 }}>{action}</View> : null}
    </View>
  );
}

export function ProfileGroup({ label, children, testID }: PropsWithChildren<{ label?: string; testID?: string }>) {
  const tokens = useTokens();
  const c = tokens.color;
  return (
    <View testID={testID}>
      {label ? (
        <Text style={{ fontSize: 13, fontWeight: '600', color: c.sub, marginLeft: 4, marginBottom: 8 }}>{label}</Text>
      ) : null}
      <View style={{ backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: c.line, overflow: 'hidden' }}>
        {children}
      </View>
    </View>
  );
}

function Square({ icon, danger }: { icon: IconName; danger?: boolean }) {
  const tokens = useTokens();
  const { scheme } = useTheme();
  const tone = danger ? { ink: tokens.color.red, soft: tokens.color.red50 } : familyTone(icon, scheme);
  return (
    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: tone.soft, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={20} color={tone.ink} fillOpacity={0.18} />
    </View>
  );
}

function Divider() {
  const tokens = useTokens();
  return <View style={{ position: 'absolute', top: 0, left: 64, right: 0, height: 1, backgroundColor: tokens.color.line }} />;
}

/** A fact on the record: label above, value below (the value is the bigger line). */
export function InfoRow({
  icon,
  label,
  children,
  first,
  testID,
}: PropsWithChildren<{ icon: IconName; label: string; first?: boolean; testID?: string }>) {
  const tokens = useTokens();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, paddingVertical: 12, paddingHorizontal: 16 }}>
      {!first && <Divider />}
      <Square icon={icon} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 13, lineHeight: 18, color: tokens.color.sub }}>{label}</Text>
        {typeof children === 'string' ? (
          <Text style={{ fontSize: 16, lineHeight: 22, fontWeight: '500', color: tokens.color.ink, marginTop: 2 }}>{children}</Text>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

/** The 16/500 value style, for callers that compose their own value line. */
export function useInfoValueStyle() {
  const tokens = useTokens();
  return { fontSize: 16, lineHeight: 22, fontWeight: '500' as const, color: tokens.color.ink, marginTop: 2 };
}

const Chevron = ({ color }: { color: string }) => (
  <Svg width={20} height={20} viewBox="0 0 24 24" accessible={false}>
    <Path d="M9 6l6 6-6 6" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const ExitGlyph = ({ color }: { color: string }) => (
  <Svg width={20} height={20} viewBox="0 0 24 24" accessible={false}>
    <Path d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8M10 12h10m-3-3 3 3-3 3" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

/** A door: the whole 56 dp row is the target. */
export function LinkRow({
  icon,
  label,
  onPress,
  testID,
  first,
  sub,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  testID?: string;
  first?: boolean;
  sub?: string;
}) {
  const tokens = useTokens();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: sub ? 72 : 56,
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: pressed ? tokens.color.surfaceMuted : 'transparent',
      })}
    >
      {!first && <Divider />}
      <Square icon={icon} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 16, lineHeight: 22, fontWeight: '500', color: tokens.color.ink }}>{label}</Text>
        {sub ? <Text style={{ fontSize: 13, lineHeight: 18, color: tokens.color.sub, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      <Chevron color={tokens.color.sub} />
    </Pressable>
  );
}

/** Sign out: a red door alone in its own card. Still asks first (the caller's onPress). */
export function SignOutRow({ onPress, testID = 'profile-signout' }: { onPress: () => void; testID?: string }) {
  const tokens = useTokens();
  return (
    <ProfileGroup>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minHeight: 56,
          paddingHorizontal: 16,
          backgroundColor: pressed ? tokens.color.red50 : 'transparent',
        })}
      >
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: tokens.color.red50, alignItems: 'center', justifyContent: 'center' }}>
          <ExitGlyph color={tokens.color.red} />
        </View>
        <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: tokens.color.red }}>Sign out</Text>
      </Pressable>
    </ProfileGroup>
  );
}
