import { Screen } from '@/components/ui';
import { ChangePasswordCard } from '@/components/ChangePasswordCard';

/**
 * The Change-password door (pitch №7): the same `ChangePasswordCard` that
 * used to sit unfolded on the Profile page, on its own pushed screen.
 */
export default function StaffPassword() {
  return (
    <Screen>
      <ChangePasswordCard />
    </Screen>
  );
}
