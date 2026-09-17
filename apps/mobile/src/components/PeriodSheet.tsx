import { useRef } from 'react';
import { ScrollView } from 'react-native';
import { ClassNotesPanel } from './ClassNotesPanel';
import { Sheet } from './Sheet';
import { useTokens } from '@/theme/theme-context';

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
 * class, which subject, today. The sheet itself is the shared `Sheet`
 * (scrim, handle, slide-or-fade, keyboard) — second edition.
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

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`This period · ${className} · ${subjectName}`}
      subtitle="Notes and to-dos file against this class, this subject, today."
      testID="period-sheet"
      backdropTestID="period-sheet-backdrop"
      backdropLabel="Close this period's notes and to-dos"
      maxHeight="82%"
    >
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
    </Sheet>
  );
}
