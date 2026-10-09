import { router } from 'expo-router';
import type { IconName } from './icons';
import { LinkRow, ProfileGroup } from './ProfileKit';
export interface ProfileMenuRow {
  /** Drawn duotone glyph on the 30px tile — same voice as the profile's record rows. */
  icon: IconName;
  label: string;
  route: string;
  testID: string;
}

/**
 * THE PROFILE'S DOORS (pitch №7). The Appearance panel and the
 * change-password form used to sit fully unfolded on the Profile page —
 * two whole control surfaces on a screen visited mostly to glance at
 * facts, pushing Sign out below the fold. Each is now one ruled row that
 * pushes its own screen inside the profile stack; the controls themselves
 * are re-housed unchanged, and the back chip comes free from the
 * positional rule in `lib/screen-titles.ts`.
 *
 * The row anatomy mirrors the record card's `ProfileRow` (30px tile,
 * ruled separators) so the menu reads as more of the same record, plus a
 * chevron because these rows go somewhere.
 */
export function ProfileMenu({ rows, label = 'Settings' }: { rows: ProfileMenuRow[]; label?: string }) {
  // sckools-ui-standards §6: a labelled r24 group of 56 dp doors.
  return (
    <ProfileGroup label={label}>
      {rows.map((row, i) => (
        <LinkRow
          key={row.testID}
          first={i === 0}
          testID={row.testID}
          icon={row.icon}
          label={row.label}
          onPress={() => router.push(row.route as Parameters<typeof router.push>[0])}
        />
      ))}
    </ProfileGroup>
  );
}
