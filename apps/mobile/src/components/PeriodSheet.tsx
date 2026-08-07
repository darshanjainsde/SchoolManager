import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { ClassNotesPanel } from './ClassNotesPanel';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

export interface PeriodSheetProps {
  open: boolean;
  /** Which half the teacher asked for — 'todos' scrolls the sheet to it. */
  focus: 'notes' | 'todos';
  classSectionId: string;
  /** YYYY-MM-DD. */
  date: string;
  subjectId: string;
  className: string;
  subjectName: string;
  onClose: () => void;
}

/**
 * THE PERIOD DESK (pitch №6). Tapping Notes or To-dos on the period kit
 * raises this bottom sheet over Home — the corridor path: one thumb, no
 * navigation, the tab bar's world untouched underneath.
 *
 * It re-houses `ClassNotesPanel` verbatim — the same component the full
 * Notes tool mounts — so fetching, composing and toggling stay one
 * implementation. The sheet only adds the address label on top: which
 * class, which subject, today.
 *
 * Reduce-motion: the slide becomes a fade, same rule as every animation
 * since the gate. (`AccessibilityInfo` resolves into state before this is
 * ever `open`, so the first raise already respects the setting.)
 */
export function PeriodSheet({
  open,
  focus,
  classSectionId,
  date,
  subjectId,
  className,
  subjectName,
  onClose,
}: PeriodSheetProps) {
  const tokens = useTokens();
  const scrollRef = useRef<ScrollView>(null);
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
    <Modal
      visible={open}
      transparent
      animationType={reduced ? 'fade' : 'slide'}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end' }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* The dimmed page behind the desk; tapping it puts the desk away. */}
        <Pressable
          testID="period-sheet-backdrop"
          accessibilityRole="button"
          accessibilityLabel="Close this period's notes and to-dos"
          onPress={onClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: `${tokens.color.ink}73` }}
        />
        <View
          testID="period-sheet"
          style={{
            backgroundColor: tokens.color.appBg,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            paddingHorizontal: 14,
            paddingTop: 8,
            paddingBottom: 18,
            maxHeight: '82%',
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
              backgroundColor: tokens.color.line,
              alignSelf: 'center',
              marginBottom: 9,
            }}
          />
          <Text
            style={{
              fontFamily: font.serif,
              fontSize: 17,
              fontWeight: '600',
              letterSpacing: -0.2,
              color: tokens.color.ink,
            }}
          >
            {`This period · ${className} · ${subjectName}`}
          </Text>
          <Text style={{ fontSize: 12, color: tokens.color.sub, marginTop: 2, marginBottom: 10 }}>
            Notes and to-dos file against this class, this subject, today.
          </Text>
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: tokens.gap, paddingBottom: 6 }}
            onContentSizeChange={() => {
              // "Opens to the half you asked for": the to-dos live below the
              // notes, so a To-dos tap lands the sheet already scrolled there.
              if (focus === 'todos') scrollRef.current?.scrollToEnd?.({ animated: false });
            }}
          >
            <ClassNotesPanel
              classSectionId={classSectionId}
              date={date}
              subjectId={subjectId}
              subjectName={subjectName}
            />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
