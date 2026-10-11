'use client';
import { ClassNotesSection } from './class-notes';
import { TvSection } from './tv';

/**
 * Settings → General: the smaller school-wide choices that are neither the
 * calendar nor messages. Class notes visibility and the reception TV.
 */
export default function GeneralSettingsPage() {
  return (
    <div data-testid="general-settings">
      <ClassNotesSection />
      <TvSection />
    </div>
  );
}
