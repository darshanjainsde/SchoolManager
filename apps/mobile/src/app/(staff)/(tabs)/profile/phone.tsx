import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { TextField } from '@/components/Field';
import { Card, Empty, ErrorState, Page, PageHeader, Pill, Screen, SectionTitle, Toast } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/** `GET /me/phone` — the person's own WhatsApp number and where it stands. */
interface PhoneStatus {
  phone: string | null;
  verified: boolean;
  verifiedAt: string | null;
  pending: string | null;
  pendingUntil: string | null;
  platformReady: boolean;
}

/**
 * MY WHATSAPP NUMBER — the same three states as the web card: nothing yet,
 * a code on its way, verified. Proving the number is what makes the leave
 * decisions and the classes to cover arrive on WhatsApp with buttons that
 * act; without it they still reach this app and email.
 */
export default function MyPhone() {
  const tokens = useTokens();
  const q = useQuery<PhoneStatus>('/me/phone');
  const d = q.data;
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | 'clear' | null>(null);
  const [note, setNote] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [editing, setEditing] = useState(false);

  const say = (e: unknown) => setNote({ kind: 'error', message: e instanceof ApiError ? e.message : 'Something went wrong.' });

  const send = async () => {
    if (!phone.trim()) return;
    setBusy('send'); setNote(null);
    try {
      const r = await api.request<{ ok: boolean; pending: string }>('/me/phone/request', { method: 'POST', body: { phone: phone.trim() } });
      setNote({ kind: 'success', message: `Code sent to ${r.pending} on WhatsApp.` });
      setCode('');
      q.reload();
    } catch (e) { say(e); } finally { setBusy(null); }
  };
  const verify = async () => {
    if (code.trim().length !== 6) return;
    setBusy('verify'); setNote(null);
    try {
      await api.request('/me/phone/verify', { method: 'POST', body: { code: code.trim() } });
      setNote({ kind: 'success', message: 'Verified — your WhatsApp is connected.' });
      setEditing(false); setPhone(''); setCode('');
      q.reload();
    } catch (e) { say(e); } finally { setBusy(null); }
  };
  const clear = async () => {
    setBusy('clear'); setNote(null);
    try { await api.request('/me/phone', { method: 'DELETE' }); setNote({ kind: 'success', message: 'Removed.' }); q.reload(); } catch (e) { say(e); } finally { setBusy(null); }
  };

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <SectionTitle title="My WhatsApp number" />
      {q.loading && <LoadingRows label="Checking…" rows={2} />}
      {q.error && !d && <ErrorState error={q.error} onRetry={q.reload} />}
      {d && (
        <>
          <Card>
            <View style={{ padding: 12, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Pill tone={d.verified ? 'green' : d.pending ? 'amber' : 'neutral'}>
                  {d.verified ? 'Verified' : d.pending ? 'Code sent' : 'Not set'}
                </Pill>
                {d.phone || d.pending ? <Text testID="phone-number" style={{ fontFamily: font.mono, fontSize: 14, fontWeight: '600', color: tokens.color.ink }}>{d.verified ? d.phone : d.pending}</Text> : null}
              </View>
              <Text style={{ fontSize: 12.5, lineHeight: 18, color: tokens.color.ink2 }}>
                Your leave decisions and the classes you are asked to cover arrive here, with buttons that act. Without a verified number they still reach this app and your email.
              </Text>
              {!d.platformReady ? <Text testID="phone-platform-off" style={{ fontSize: 12, color: tokens.color.sub }}>WhatsApp is not connected on the platform yet — you can verify once it is.</Text> : null}
            </View>
          </Card>

          {d.verified && !editing ? (
            <Page>
              <PageHeader title="Change or remove" />
              <View style={{ flexDirection: 'row', gap: 10, padding: 12 }}>
                <Pressable testID="phone-change" onPress={() => setEditing(true)} style={{ paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, backgroundColor: tokens.color.indigo }}><Text style={{ color: tokens.color.onBrand, fontWeight: '700' }}>Change</Text></Pressable>
                <Pressable testID="phone-remove" onPress={clear} disabled={busy !== null} style={{ paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: tokens.color.line }}><Text style={{ color: tokens.color.ink, fontWeight: '600' }}>{busy === 'clear' ? 'Removing…' : 'Remove'}</Text></Pressable>
              </View>
            </Page>
          ) : (
            <Page>
              <PageHeader title="Your number" />
              <View style={{ padding: 12, gap: 10 }}>
                <TextField label="WhatsApp number" value={phone} onChangeText={setPhone} placeholder="98765 43210" keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" testID="phone-input" />
                <Pressable testID="phone-send" onPress={send} disabled={!d.platformReady || busy !== null || !phone.trim()} style={{ alignSelf: 'flex-start', paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, backgroundColor: tokens.color.indigo, opacity: !d.platformReady || !phone.trim() ? 0.5 : 1 }}>
                  <Text style={{ color: tokens.color.onBrand, fontWeight: '700' }}>{busy === 'send' ? 'Sending…' : d.pending ? 'Send again' : 'Send code'}</Text>
                </Pressable>
                {editing ? <Pressable onPress={() => { setEditing(false); setPhone(''); }}><Text style={{ color: tokens.color.sub, fontSize: 12.5 }}>Cancel</Text></Pressable> : null}
              </View>
            </Page>
          )}

          {d.pending && !d.verified ? (
            <Page testID="phone-verify">
              <PageHeader title="The 6-digit code from WhatsApp" />
              <View style={{ padding: 12, gap: 10 }}>
                <TextField label="Code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} placeholder="482911" keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} testID="phone-code" />
                <Pressable testID="phone-verify-go" onPress={verify} disabled={busy !== null || code.length !== 6} style={{ alignSelf: 'flex-start', paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, backgroundColor: tokens.color.indigo, opacity: code.length !== 6 ? 0.5 : 1 }}>
                  <Text style={{ color: tokens.color.onBrand, fontWeight: '700' }}>{busy === 'verify' ? 'Checking…' : 'Verify'}</Text>
                </Pressable>
                <Text style={{ fontSize: 11.5, color: tokens.color.sub }}>Sent to {d.pending}. It works for 10 minutes; ask for another after a minute if it does not arrive.</Text>
              </View>
            </Page>
          ) : null}

          {!d.verified && !d.pending && !q.loading ? <Empty icon="phone">No number yet. Add yours above.</Empty> : null}
          {note ? <Toast testID="phone-note" kind={note.kind} message={note.message} /> : null}
        </>
      )}
    </Screen>
  );
}
