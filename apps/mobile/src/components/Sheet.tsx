import { useEffect, useState, type PropsWithChildren, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/**
 * THE SLIP — one bottom sheet for the whole app.
 *
 * The calendar and the period desk each built their own scrim, handle and
 * slide; the pay sheet would have been a third. This is that anatomy once:
 * a dimmed page behind, a paper sheet that slides up (a fade under Reduce
 * Motion, the standing rule), a handle, a serif title in the page's own
 * voice, and the keyboard pushing the sheet rather than covering it.
 *
 * `testID`/`backdropTestID` are explicit rather than derived so the two
 * sheets that already had tests keep their ids verbatim.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  testID = 'sheet',
  backdropTestID = `${testID}-backdrop`,
  backdropLabel = 'Close',
  maxHeight = '86%',
  footer,
}: PropsWithChildren<{
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  testID?: string;
  backdropTestID?: string;
  backdropLabel?: string;
  maxHeight?: `${number}%`;
  /** Pinned under the scrolling body — a primary action that must never scroll away. */
  footer?: ReactNode;
}>) {
  const tokens = useTokens();
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (!cancelled) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduced(v));
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return (
    <Modal visible={open} transparent animationType={reduced ? 'fade' : 'slide'} onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end' }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          testID={backdropTestID}
          accessibilityRole="button"
          accessibilityLabel={backdropLabel}
          onPress={onClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: `${tokens.color.ink}73` }}
        />
        <View
          testID={testID}
          style={{
            backgroundColor: tokens.color.appBg,
            borderTopLeftRadius: tokens.radius.sheet,
            borderTopRightRadius: tokens.radius.sheet,
            paddingHorizontal: 14,
            paddingTop: 8,
            paddingBottom: 18,
            maxHeight,
            shadowColor: tokens.color.ink,
            shadowOpacity: 0.3,
            shadowRadius: 30,
            shadowOffset: { width: 0, height: -8 },
            elevation: 16,
          }}
        >
          <View
            style={{
              width: 34,
              height: 4,
              borderRadius: 99,
              backgroundColor: tokens.color.line2,
              alignSelf: 'center',
              marginBottom: 9,
            }}
          />
          {title ? (
            <Text
              style={{
                fontFamily: font.serif,
                fontSize: 17,
                fontWeight: '600',
                letterSpacing: -0.2,
                color: tokens.color.ink,
                marginBottom: subtitle ? 2 : 8,
              }}
            >
              {title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text style={{ fontSize: 12, color: tokens.color.sub, marginBottom: 10 }}>{subtitle}</Text>
          ) : null}
          {children}
          {footer ? <View style={{ marginTop: 10 }}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
