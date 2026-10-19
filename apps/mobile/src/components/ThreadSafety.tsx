import { useState } from 'react';
import { Text, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { useTokens } from '@/theme/theme-context';
import { Button } from './Button';
import { ask } from './ConfirmSheet';

/**
 * REPORT AND BLOCK on a conversation (Google Play user-generated content
 * policy, 19 Oct 2026 audit: an app where registered users message each other
 * must let them report abuse and block a user; children use this app).
 *
 * Both sides of a thread get the same two text buttons under the thread's
 * header. Report asks why (three plain reasons) and goes to the school's
 * admins. Block stops new messages in this conversation for both people
 * until the blocker unblocks it; the composer is hidden while it is blocked.
 * API: POST {base}/:threadId/report {reason} and {base}/:threadId/block {blocked}.
 */
export function ThreadSafety({
  base,
  threadId,
  blockedByMe,
  blockedByOther,
  otherName,
  onBlockedChange,
}: {
  base: '/manage/messages' | '/me/messages';
  threadId: string;
  blockedByMe: boolean;
  blockedByOther: boolean;
  /** Who is on the other side, for the confirm copy ("Block Rekha Sinha?"). */
  otherName: string;
  onBlockedChange: (blocked: boolean) => void;
}) {
  const tokens = useTokens();
  const [busy, setBusy] = useState<null | 'report' | 'block'>(null);
  const [note, setNote] = useState<string | null>(null);

  async function report(reason: string) {
    setBusy('report');
    setNote(null);
    try {
      await api.request(`${base}/${threadId}/report`, { method: 'POST', body: { reason } });
      setNote('Reported. Your school will look at this conversation.');
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : 'Could not send the report. Try again.');
    } finally {
      setBusy(null);
    }
  }

  function askReport() {
    ask(
      'Report this conversation?',
      'Your school’s admins will see this conversation and your reason. The other person is not told who reported it.',
      [
        { text: 'Rude or abusive', onPress: () => void report('Rude or abusive') },
        { text: 'Spam or not about school', onPress: () => void report('Spam or not about school') },
        { text: 'Something else', onPress: () => void report('Something else') },
        { text: 'Cancel', style: 'cancel' },
      ],
      { icon: 'alert', testID: 'confirm-report' },
    );
  }

  async function setBlocked(next: boolean) {
    setBusy('block');
    setNote(null);
    try {
      const r = await api.request<{ blocked: boolean }>(`${base}/${threadId}/block`, { method: 'POST', body: { blocked: next } });
      onBlockedChange(r.blocked);
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : 'Could not change this. Try again.');
    } finally {
      setBusy(null);
    }
  }

  function askBlock() {
    if (blockedByMe) return void setBlocked(false);
    ask(
      `Block ${otherName}?`,
      'Neither of you can send new messages in this conversation until you unblock it. You can still read what is here, and report it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Block', style: 'destructive', onPress: () => void setBlocked(true) },
      ],
      { icon: 'lock', testID: 'confirm-block' },
    );
  }

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 4 }}>
        <Button testID="thread-report" variant="text" size="sm" icon="alert" label="Report" busy={busy === 'report'} onPress={askReport} />
        <Button testID="thread-block" variant="text" size="sm" icon="lock" label={blockedByMe ? 'Unblock' : 'Block'} busy={busy === 'block'} onPress={askBlock} />
      </View>
      {(blockedByMe || blockedByOther) && (
        <Text testID="thread-blocked" style={{ fontSize: 13, lineHeight: 18, color: tokens.color.sub, textAlign: 'center' }}>
          {blockedByMe ? 'You blocked this conversation. Unblock it to send messages again.' : 'This conversation is blocked. New messages cannot be sent.'}
        </Text>
      )}
      {note && (
        <Text testID="thread-safety-note" style={{ fontSize: 13, lineHeight: 18, color: tokens.color.sub, textAlign: 'center' }}>
          {note}
        </Text>
      )}
    </View>
  );
}
