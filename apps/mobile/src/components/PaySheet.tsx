import { useState } from 'react';
import { Linking, Pressable, Share, Text, View } from 'react-native';
import { Sheet } from './Sheet';
import { DateField, MoneyField, PhotoField, SegmentedField, TextField, type PickedPhoto } from './Field';
import { LoadingRows } from './Loading';
import { ErrorState, Toast } from './ui';
import { api, ApiError } from '@/lib/api';
import { invalidate, useQuery } from '@/lib/query';
import { todayISO } from '@/lib/attendance';
import { rupees } from '@/lib/money';
import { METHOD_LABEL, type BankInstructions, type FeePaymentMethod } from '@/lib/fees';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/** The four ways a family actually pays a school; card/netbanking ride the gateway rail. */
const METHODS: readonly { value: FeePaymentMethod; label: string }[] = [
  { value: 'UPI', label: 'UPI' },
  { value: 'NEFT_IMPS', label: 'Bank' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CASH', label: 'Cash' },
];

/** The server ignores this — it resolves the student from the login — but the DTO requires the field. */
const IGNORED_STUDENT_ID = '00000000-0000-0000-0000-000000000000';

export interface PaySheetProps {
  open: boolean;
  onClose: () => void;
  /** The bill being paid; null for an advance with no bill yet. */
  invoiceId: string | null;
  /** What the family has to send today, in paise. */
  dueMinor: number;
  /** Called after a claim is accepted by the server. */
  onSubmitted: () => void;
}

/**
 * PAY BY BANK TRANSFER — two steps, deliberately.
 *
 * Step one is the school's bank details and the one thing a phone can do
 * that the web page cannot: open GPay or PhonePe with the amount already
 * filled, from the `upi://` intent the API composes. Step two is telling the
 * school — the claim that becomes SUBMITTED, which the office confirms.
 *
 * Nothing in here touches money. A claim writes a SUBMITTED row and nothing
 * else; the ledger moves only when a human verifies it.
 */
export function PaySheet({ open, onClose, invoiceId, dueMinor, onSubmitted }: PaySheetProps) {
  const tokens = useTokens();
  const bank = useQuery<BankInstructions>(
    open ? `/me/fees/bank-instructions${invoiceId ? `?invoiceId=${invoiceId}` : ''}` : null,
  );
  const [telling, setTelling] = useState(false);

  const b = bank.data?.bank ?? null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={telling ? 'Tell the school' : 'Pay by bank transfer'}
      subtitle={telling ? 'The office confirms it, usually within a day.' : `Send ${rupees(dueMinor)} to the school's account.`}
      testID="pay-sheet"
      backdropLabel="Close"
    >
      {!telling && (
        <View style={{ gap: tokens.gap }}>
          {bank.loading && <LoadingRows label="Getting the school's bank details…" rows={3} />}
          {bank.error && !b && <ErrorState error={bank.error} onRetry={bank.reload} testID="pay-bank-error" />}
          {b && (
            <>
              <View
                testID="pay-bank-details"
                style={{
                  backgroundColor: tokens.color.surface,
                  borderColor: tokens.color.line,
                  borderWidth: 1,
                  borderRadius: 13,
                  paddingHorizontal: 12,
                  paddingVertical: 4,
                }}
              >
                <DetailRow label="Name" value={b.accountName} />
                <DetailRow label="Account" value={b.accountNumber} />
                <DetailRow label="IFSC" value={b.ifsc} />
                {b.upiId ? <DetailRow label="UPI" value={b.upiId} /> : null}
                <DetailRow label="Bank" value={b.branch ? `${b.bankName} · ${b.branch}` : b.bankName} last />
              </View>
              {b.instructions ? (
                <Text style={{ fontSize: 12, color: tokens.color.sub, lineHeight: 17 }}>{b.instructions}</Text>
              ) : null}
              {b.upiIntentUri ? (
                <Button
                  testID="pay-open-upi"
                  label={`Open in a UPI app — ${rupees(dueMinor)}`}
                  onPress={() => void Linking.openURL(b.upiIntentUri!).catch(() => undefined)}
                />
              ) : null}
              <Button
                testID="pay-share-details"
                variant="ghost"
                label="Share the bank details"
                onPress={() =>
                  void Share.share({
                    message: [
                      `${b.accountName}`,
                      `A/c ${b.accountNumber}`,
                      `IFSC ${b.ifsc}`,
                      b.upiId ? `UPI ${b.upiId}` : null,
                      `Amount ${rupees(dueMinor)}`,
                    ]
                      .filter(Boolean)
                      .join('\n'),
                  }).catch(() => undefined)
                }
              />
            </>
          )}
          <Button testID="pay-tell" variant="ghost" label="I’ve paid — tell the school" onPress={() => setTelling(true)} />
        </View>
      )}
      {telling && (
        <ClaimForm
          invoiceId={invoiceId}
          dueMinor={dueMinor}
          onBack={() => setTelling(false)}
          onSubmitted={() => {
            setTelling(false);
            onSubmitted();
          }}
        />
      )}
    </Sheet>
  );
}

function DetailRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const tokens = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: tokens.color.line,
      }}
    >
      <Text style={{ fontSize: 12, color: tokens.color.sub }}>{label}</Text>
      {/* Selectable, so a long press copies it — no clipboard dependency. */}
      <Text selectable style={{ fontFamily: font.mono, fontSize: 13, color: tokens.color.ink, flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
  testID?: string;
}) {
  const tokens = useTokens();
  const primary = variant === 'primary';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 14,
        backgroundColor: primary ? tokens.color.indigo : 'transparent',
        borderWidth: 1,
        borderColor: tokens.color.indigo,
        opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ color: primary ? tokens.color.onBrand : tokens.color.indigo, fontWeight: '700', fontSize: 13.5 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Step two. Amount, date, how, the reference, a screenshot — then Send. */
function ClaimForm({
  invoiceId,
  dueMinor,
  onBack,
  onSubmitted,
}: {
  invoiceId: string | null;
  dueMinor: number;
  onBack: () => void;
  onSubmitted: () => void;
}) {
  const tokens = useTokens();
  const [method, setMethod] = useState<FeePaymentMethod>('UPI');
  const [amountMinor, setAmountMinor] = useState(dueMinor);
  const [paidOn, setPaidOn] = useState(todayISO());
  const [reference, setReference] = useState('');
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const today = todayISO();
  const canSend = !busy && amountMinor > 0 && paidOn <= today;

  async function send() {
    setBusy(true);
    setProblem(null);
    try {
      const form = new FormData();
      form.append('studentId', IGNORED_STUDENT_ID);
      if (invoiceId) form.append('invoiceId', invoiceId);
      form.append('method', method);
      form.append('amountMinor', String(amountMinor));
      form.append('paidOn', paidOn);
      if (reference.trim()) form.append('reference', reference.trim());
      if (photo) {
        // RN FormData file part: { uri, name, type } — fetch streams it as
        // multipart; api.upload leaves Content-Type to fetch for the boundary.
        form.append('file', { uri: photo.uri, name: photo.name, type: photo.type } as unknown as Blob);
      }
      await api.upload('/me/fees/submit', form);
      invalidate('/me/fees');
      onSubmitted();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // The partial unique index on providerRef caught the same transfer
        // told twice — a fact, not a fault.
        setProblem('You’ve already told the school about this payment.');
      } else if (e instanceof ApiError && e.status === 0) {
        // The form stays exactly as it was; nothing typed is lost.
        setProblem('No signal right now. Everything you filled in is still here — try again when you’re back.');
      } else {
        setProblem(e instanceof ApiError ? e.message : 'Something went wrong.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: tokens.gap }}>
      <SegmentedField label="How you paid" options={METHODS} value={method} onChange={setMethod} testID="claim-method" />
      <MoneyField label="Amount you paid" valueMinor={amountMinor} onChangeMinor={setAmountMinor} testID="claim-amount" />
      <DateField label="Date you paid" value={paidOn} onChange={setPaidOn} maxDate={today} testID="claim-date" />
      <TextField
        label={method === 'CASH' ? 'Receipt number (if you have one)' : 'UPI reference / UTR'}
        value={reference}
        onChangeText={setReference}
        placeholder={method === 'CASH' ? 'optional' : '12-digit reference from your bank'}
        autoCapitalize="characters"
        autoCorrect={false}
        testID="claim-reference"
      />
      <PhotoField label="Screenshot or receipt" value={photo} onChange={setPhoto} testID="claim-photo" />
      {problem && <Toast kind="error" message={problem} testID="claim-problem" />}
      <Button testID="claim-send" label={busy ? 'Sending…' : 'Send to the school'} onPress={() => void send()} disabled={!canSend} />
      <Pressable testID="claim-back" accessibilityRole="button" onPress={onBack} hitSlop={8} style={{ alignSelf: 'center', paddingVertical: 6 }}>
        <Text style={{ fontSize: 12.5, fontWeight: '700', color: tokens.color.indigo }}>Back to the bank details</Text>
      </Pressable>
    </View>
  );
}
