import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { Button } from '@/components/desk';
import { TextField } from '@/components/Field';
import { Card, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

export interface PayDetailsPayload {
  bankAccount: string | null; bankIfsc: string | null; bankName: string | null;
  pan: string | null; uan: string | null; esiNumber: string | null;
  onPay: boolean;
  missing: string[];
}

/** The same shapes the server enforces, so a typo is caught before a round trip. */
const RE = {
  bankAccount: /^[0-9]{9,18}$/,
  bankIfsc: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  pan: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  uan: /^[0-9]{12}$/,
};

/**
 * WHERE MY PAY GOES — on the phone, where most of a school's staff actually
 * are. A driver with no laptop can put their own account in.
 *
 * It writes the SAME rows the office writes, so the moment this saves, the
 * school's "no bank account" exception clears on their side. There is no
 * second copy of this anywhere, and nothing to sync.
 */
export function PayDetails() {
  const tokens = useTokens();
  const q = useQuery<PayDetailsPayload>('/me/pay/details');
  const [form, setForm] = useState({ bankAccount: '', bankIfsc: '', bankName: '', pan: '', uan: '' });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the server's answer in once, and never again over something typed.
  useEffect(() => {
    const d = q.data;
    if (!d || dirty) return;
    setForm({
      bankAccount: d.bankAccount ?? '', bankIfsc: d.bankIfsc ?? '', bankName: d.bankName ?? '',
      pan: d.pan ?? '', uan: d.uan ?? '',
    });
  }, [q.data, dirty]);

  // A school that has not switched Pay on answers 403/404 — not an error the
  // person can do anything about, so the card simply is not there.
  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404)) return null;
  const d = q.data;
  if (!d) return null;

  const set = (k: keyof typeof form) => (v: string) => {
    setForm({ ...form, [k]: k === 'bankIfsc' || k === 'pan' ? v.toUpperCase() : v });
    setDirty(true); setSaved(false);
  };
  const bad = (k: keyof typeof RE) => form[k].trim() !== '' && !RE[k].test(form[k].trim());
  const pairBroken = !!form.bankAccount.trim() !== !!form.bankIfsc.trim();
  const blocked = bad('bankAccount') || bad('bankIfsc') || bad('pan') || bad('uan') || pairBroken;

  async function save() {
    setSaving(true); setError(null);
    try {
      await api.request<PayDetailsPayload>('/me/pay/details', { method: 'POST', body: form });
      setSaved(true); setDirty(false);
      q.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
      setSaved(false);
    } finally {
      setSaving(false);
    }
  }

  const hint = (t: string, tone?: 'bad') => (
    <Text style={{ fontFamily: font.sans, fontSize: 11.5, color: tone === 'bad' ? tokens.color.red : tokens.color.sub, marginTop: 2 }}>
      {t}
    </Text>
  );

  return (
    <>
      <SectionTitle title="Where my pay goes" />
      <Card>
        {!d.onPay ? (
          <Text style={{ fontFamily: font.sans, fontSize: 13, color: tokens.color.sub }}>
            Your pay has not been set up yet. Once the office puts you on a grade, your bank details
            can be saved here.
          </Text>
        ) : (
          <View style={{ gap: 12 }}>
            {d.missing.length > 0 ? (
              <View style={{ backgroundColor: tokens.color.amber50, borderLeftWidth: 3, borderLeftColor: tokens.color.amber, borderRadius: 9, padding: 10 }}>
                <Text style={{ fontFamily: font.sans, fontSize: 12.5, color: tokens.color.ink }}>
                  Still needed: {d.missing.join(', ')}. Without these the school cannot pay you by
                  bank transfer or file your tax correctly.
                </Text>
              </View>
            ) : null}

            <View>
              <TextField
                label="Bank account number" value={form.bankAccount} onChangeText={set('bankAccount')}
                keyboardType="number-pad" maxLength={18} placeholder="30123456789" mono
                testID="pay-bank-account"
              />
              {hint(bad('bankAccount') ? '9 to 18 digits.' : 'Exactly as the passbook prints it.', bad('bankAccount') ? 'bad' : undefined)}
            </View>

            <View>
              <TextField
                label="IFSC" value={form.bankIfsc} onChangeText={set('bankIfsc')}
                autoCapitalize="characters" maxLength={11} placeholder="SBIN0001234" mono
                testID="pay-bank-ifsc"
              />
              {hint('Four letters, a zero, then six characters.', bad('bankIfsc') ? 'bad' : undefined)}
            </View>

            <TextField
              label="Bank name" value={form.bankName} onChangeText={set('bankName')}
              maxLength={60} placeholder="State Bank of India" testID="pay-bank-name"
            />

            <View>
              <TextField
                label="PAN" value={form.pan} onChangeText={set('pan')}
                autoCapitalize="characters" maxLength={10} placeholder="ABCDE1234F" mono
                testID="pay-pan"
              />
              {hint('Without it, tax is deducted at the higher rate.', bad('pan') ? 'bad' : undefined)}
            </View>

            <View>
              <TextField
                label="Provident fund number (UAN)" value={form.uan} onChangeText={set('uan')}
                keyboardType="number-pad" maxLength={12} placeholder="100123456789" mono
                testID="pay-uan"
              />
              {hint('Twelve digits. Optional if you are not a member.', bad('uan') ? 'bad' : undefined)}
            </View>

            {pairBroken ? hint('An account number needs its IFSC, and an IFSC needs its account.', 'bad') : null}
            {error ? hint(error, 'bad') : null}

            <Button label={saving ? 'Saving…' : 'Save'} onPress={save} disabled={saving || blocked || !dirty} testID="pay-details-save" />
            {saved ? hint('Saved. The office sees this straight away.') : null}
            {hint('You can change these whenever you like. A change applies to money paid from now on — it does not alter a payslip already issued.')}
          </View>
        )}
      </Card>
    </>
  );
}
