import { useEffect } from 'react';
import { Linking } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { LinkRow, ProfileGroup } from './ProfileKit';
import { ask } from './ConfirmSheet';
import { useSession } from '@/lib/use-session';

/**
 * PRIVACY AND ACCOUNT (Google Play, 19 Oct 2026 audit). Play requires an
 * in-app way to start deleting an account, and the privacy policy reachable
 * from inside the app. The pages live on sckools.com (checked 200 on
 * 19 Oct 2026); deletion is handled with the person's school, which holds
 * the records, so the row explains that before it opens the request page.
 */
export const LEGAL = {
  privacy: 'https://sckools.com/privacy',
  terms: 'https://sckools.com/terms',
  deleteAccount: 'https://sckools.com/delete-account',
} as const;

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

export function confirmDeleteAccount(): void {
  ask(
    'Delete your account?',
    'Your school keeps your class records, so deletion is done together with them. The next page sends the request; we confirm with your school and delete your login, messages and personal details. Records the school must keep by law (attendance, results, fees) stay with the school.',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Request deletion', style: 'destructive', onPress: () => open(LEGAL.deleteAccount) },
    ],
    { icon: 'trash', testID: 'confirm-delete-account' },
  );
}

/** The Profile group every role shows above Sign out. */
export function PrivacyGroup() {
  return (
    <ProfileGroup label="Privacy and account">
      <LinkRow first testID="profile-privacy" icon="lock" label="Privacy policy" onPress={() => open(LEGAL.privacy)} />
      <LinkRow testID="profile-terms" icon="report" label="Terms of use" onPress={() => open(LEGAL.terms)} />
      <LinkRow testID="profile-delete-account" icon="trash" label="Delete my account" onPress={confirmDeleteAccount} />
    </ProfileGroup>
  );
}

const termsKey = (s: { role?: string; schoolHost?: string; displayName?: string | null }) => {
  const raw = `${s.role ?? ''}|${s.schoolHost ?? ''}|${s.displayName ?? ''}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return `sckools.terms.v1.${(h >>> 0).toString(36)}`;
};

/**
 * Once per person on this phone: the terms, the privacy policy, and what
 * messages are for (Play's user-generated content policy asks apps with
 * messaging to have users accept terms that rule out abuse).
 */
export function useTermsGate(): void {
  const s = useSession();
  const key = s ? termsKey(s) : null;
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    SecureStore.getItemAsync(key)
      .then((done) => {
        if (cancelled || done) return;
        ask(
          'Before you start',
          'Messages here are for school matters only. Be respectful: you can report or block any conversation, and reports go to your school’s admins. By continuing you agree to the Terms of use and the Privacy policy.',
          [
            { text: 'Read the terms', style: 'cancel', onPress: () => open(LEGAL.terms) },
            { text: 'Agree and continue', onPress: () => void SecureStore.setItemAsync(key, new Date().toISOString()).catch(() => undefined) },
          ],
          { icon: 'report', testID: 'confirm-terms' },
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key]);
}
