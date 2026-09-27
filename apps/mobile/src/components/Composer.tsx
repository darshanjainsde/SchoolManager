import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './icons';
import { useTokens } from '@/theme/theme-context';

/**
 * THE MESSAGE COMPOSER — one pill: the line you write on and the button that
 * sends it, docked so the transcript scrolls behind it.
 *
 * Shared because the two ends of the SAME conversation had drifted apart: a
 * 30 dp indigo circle on the family side, a 34 dp text pill on the teacher's,
 * neither lifting for the keyboard and neither clearing the gesture strip, so
 * on a gesture-navigation Android phone the send button sat where the OS
 * steals the tap (UI audit 2026-09-22, #7). One component, one 44 dp target,
 * one safe-area rule.
 */
export function Composer({
  value,
  onChangeText,
  onSend,
  sending = false,
  disabled = false,
  maxLength,
  placeholder = 'Write a message…',
  testIDPrefix = 'reply',
}: {
  value: string;
  onChangeText: (v: string) => void;
  onSend: () => void;
  sending?: boolean;
  disabled?: boolean;
  maxLength?: number;
  placeholder?: string;
  testIDPrefix?: string;
}) {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const canSend = !disabled && !sending && value.trim().length > 0;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View
        style={{
          paddingHorizontal: 10,
          paddingTop: 4,
          // Clear the home indicator / gesture strip, where a tap belongs to
          // the OS and never reaches the button.
          paddingBottom: Math.max(insets.bottom, 10),
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 7,
            backgroundColor: tokens.color.surface,
            borderWidth: 1,
            borderColor: tokens.color.line,
            borderRadius: tokens.radius.chip,
            paddingLeft: 13,
            paddingRight: 5,
            paddingVertical: 5,
            shadowColor: tokens.color.ink,
            shadowOpacity: 0.05,
            shadowRadius: 34,
            shadowOffset: { width: 0, height: 14 },
            elevation: 2,
          }}
        >
          <TextInput
            testID={`${testIDPrefix}-body`}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={tokens.color.placeholder}
            multiline
            maxLength={maxLength}
            style={{ flex: 1, fontSize: 12.5, color: tokens.color.ink, maxHeight: 110, paddingVertical: 6 }}
          />
          <Pressable
            testID={`${testIDPrefix}-send`}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend }}
            onPress={onSend}
            disabled={!canSend}
            hitSlop={8}
            // 44 dp of hit area for a thumb; the ink inside stays 34.
            style={{
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: canSend ? 1 : 0.6,
            }}
          >
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                backgroundColor: tokens.color.indigo,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {sending ? (
                <Text style={{ color: tokens.color.onBrand, fontSize: 13, fontWeight: '700' }}>…</Text>
              ) : (
                <Icon name="send" size={16} color={tokens.color.onBrand} fillOpacity={0.35} />
              )}
            </View>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
