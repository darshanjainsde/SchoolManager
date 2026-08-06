import { SettingsScreen } from '@/components/SettingsScreen';

/** Route shell — the screen itself is shared with the other portal. */
export default function Settings(): React.JSX.Element {
  return <SettingsScreen portal="family" />;
}
