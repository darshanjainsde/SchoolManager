import { useCallback, useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { api, ApiError } from '@/lib/api';
import {
  METHOD_LABEL, STATUS_LABEL, fmtDate, rupees, statusTone,
  type FeePaymentMethod, type StudentFeeInvoice, type StudentFees,
} from '@/lib/fees';
import { Card, Empty, Page, Pill, Screen, SectionTitle, Toast } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/**
 * FEES, ON THE FAMILY'S PHONE.
 *
 * `/me/fees` has worked since the module shipped and the web portal has
 * rendered it all along — there was simply never a screen here, so a parent
 * who only ever opens the app could not see a bill, a balance or a receipt.
 *
 * Answers the same three questions the web page does, in the order a parent
 * asks them: what do I owe and what is it FOR, how do I pay it, and where has
 * my payment got to. Every charge carries the sentence the school wrote in
 * setup — "Exam ₹800" starts an argument; "Exam ₹800 — question papers,
 * answer sheets and result processing" ends one.
 */

interface HowToPay {
  options: { key: string; displayName: string; kind: 'MANUAL' | 'GATEWAY'; blurb: string; available: boolean; enabled: boolean; status: string }[];
  canPayOnline: boolean;
  canPayByTransfer: boolean;
}

interface BankInstructions {
  kind: 'INSTRUCTIONS';
  bank: {
    accountName: string; accountNumber: string; ifsc: string; bankName: string;
    branch: string | null; upiId: string | null; upiQrUrl: string | null;
    upiIntentUri: string | null; instructions: string | null;
  };
}

const METHODS: FeePaymentMethod[] = ['UPI', 'NEFT_IMPS', 'CASH', 'CHEQUE', 'OTHER'];

export default function FamilyFeesScreen(): React.JSX.Element {
  const tokens = useTokens();
  const [fees, setFees] = useState<StudentFees | null>(null);
  const [how, setHow] = useState<HowToPay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openBill, setOpenBill] = useState<string | null>(null);
  const [paying, setPaying] = useState<StudentFeeInvoice | null>(null);
  const [reload, setReload] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      void Promise.all([
        api.request<StudentFees>('/me/fees'),
        api.request<HowToPay>('/me/fees/how-to-pay').catch(() => null),
      ])
        .then(([f, h]) => {
          if (cancelled) return;
          setFees(f);
          setHow(h);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          // 403 is not a failure: the school simply has not bought Fees.
          if (e instanceof ApiError && e.status === 403) {
            setError('Fees are not part of your school’s plan yet.');
          } else {
            setError(e instanceof ApiError ? e.message : 'Something went wrong.');
          }
        });
      return () => { cancelled = true; };
    }, [reload]),
  );

  if (error) {
    return (
      <Screen>
        <SectionTitle title="Fees" />
        <Card><Text style={{ color: tokens.color.sub, fontSize: 13 }}>{error}</Text></Card>
      </Screen>
    );
  }

  if (fees === null) {
    return (
      <Screen>
        <SectionTitle title="Fees" />
        <LoadingRows label="Loading your fees…" rows={4} />
      </Screen>
    );
  }

  const unpaid = fees.invoices.filter((i) => !i.isPaid);
  const pending = fees.payments.find((p) => p.status === 'SUBMITTED');

  return (
    <Screen>
      <SectionTitle title="Fees" />

      {/* ── the number the parent opened the app for ──────────────────────── */}
      <Card testID="fees-balance">
        <Text style={{ fontSize: 11.5, color: tokens.color.sub, letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: '700' }}>
          {fees.balanceMinor > 0 ? 'You owe' : fees.balanceMinor < 0 ? 'In credit' : 'All clear'}
        </Text>
        <Text
          testID="fees-balance-amount"
          style={{
            fontSize: 30, fontFamily: font.serif, fontWeight: '600', marginTop: 2,
            color: fees.balanceMinor > 0 ? tokens.color.ink : tokens.color.green,
          }}
        >
          {rupees(Math.abs(fees.balanceMinor))}
        </Text>
        <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 4 }}>
          {rupees(fees.billedMinor)} billed · {rupees(fees.paidMinor)} paid
        </Text>

        {/* The rule, not a charge. Shown even when nothing is overdue, because
            a family should learn what lateness costs BEFORE it costs them. */}
        {fees.lateFeeRule && (
          <Text style={{ fontSize: 11.5, color: tokens.color.late, marginTop: 6 }}>
            Late fee: {fees.lateFeeRule}
          </Text>
        )}

        {pending && (
          <View style={{ marginTop: 10 }}>
            <Toast
              kind="pending"
              message={`${rupees(pending.amountMinor)} is with the school office to check. Your receipt appears here once they confirm it.`}
            />
          </View>
        )}
      </Card>

      {/* ── bills, each opening to what it is made of ─────────────────────── */}
      {fees.invoices.length === 0 ? (
        <Page style={{ padding: 0 }}>
          <Empty icon="fees">No bills yet.</Empty>
        </Page>
      ) : (
        <>
          <SectionTitle title={unpaid.length > 0 ? 'To pay' : 'Your bills'} />
          <Page testID="fees-bills">
            {fees.invoices.map((inv, i) => (
              <BillRow
                key={inv.id}
                inv={inv}
                first={i === 0}
                isOpen={openBill === inv.id}
                onToggle={() => setOpenBill(openBill === inv.id ? null : inv.id)}
                onPay={() => setPaying(inv)}
                canPayByTransfer={how?.canPayByTransfer ?? false}
              />
            ))}
          </Page>
        </>
      )}

      {/* ── the transfer flow, opened from a bill ─────────────────────────── */}
      {paying && (
        <PayByTransfer
          invoice={paying}
          onClose={() => setPaying(null)}
          onDone={() => { setPaying(null); setReload((n) => n + 1); }}
        />
      )}

      {/* ── history, and the receipts behind it ───────────────────────────── */}
      {fees.payments.length > 0 && (
        <>
          <SectionTitle title="Your payments" />
          <Page testID="fees-payments">
            {fees.payments.map((p, i) => {
              const hasReceipt = p.receiptNumber !== null;
              const body = (
                <View
                  style={{
                    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
                    paddingVertical: 11, paddingHorizontal: 12,
                    borderTopWidth: i === 0 ? 0 : 1, borderTopColor: tokens.color.line,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>
                      {rupees(p.amountMinor)} · {METHOD_LABEL[p.method]}
                    </Text>
                    <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>
                      {fmtDate(p.paidOn)}
                    </Text>

                    {/* The school's own words, verbatim. */}
                    {p.ackNote !== null && (
                      <Text style={{ fontSize: 11.5, color: tokens.color.ink2, marginTop: 4, lineHeight: 16 }}>
                        “{p.ackNote}”
                      </Text>
                    )}
                    {p.rejectionReason !== null && (
                      <Text style={{ fontSize: 11.5, color: tokens.color.red, marginTop: 4, lineHeight: 16 }}>
                        {p.rejectionReason}
                      </Text>
                    )}

                    {/* A receipt exists only once the school has confirmed the
                        money, so this appears exactly when the document does. */}
                    {hasReceipt && (
                      <Text style={{ fontSize: 11.5, fontWeight: '700', color: tokens.color.indigo, marginTop: 4 }}>
                        Receipt {p.receiptNumber} ›
                      </Text>
                    )}
                  </View>
                  <Pill tone={statusTone(p.status)}>{STATUS_LABEL[p.status]}</Pill>
                </View>
              );

              return hasReceipt ? (
                <Pressable
                  key={p.id}
                  testID={`fee-payment-${p.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Receipt ${p.receiptNumber}, ${rupees(p.amountMinor)}`}
                  onPress={() => router.push(`/(family)/(tabs)/home/fees/${p.id}` as never)}
                >
                  {body}
                </Pressable>
              ) : (
                <View key={p.id} testID={`fee-payment-${p.id}`}>{body}</View>
              );
            })}
          </Page>
        </>
      )}
    </Screen>
  );
}

/** One bill, opening to the charges it is made of. */
function BillRow({
  inv, first, isOpen, onToggle, onPay, canPayByTransfer,
}: {
  inv: StudentFeeInvoice;
  first: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onPay: () => void;
  canPayByTransfer: boolean;
}) {
  const tokens = useTokens();

  return (
    <View
      testID={`fee-bill-${inv.id}`}
      style={{ borderTopWidth: first ? 0 : 1, borderTopColor: tokens.color.line, opacity: inv.isPaid ? 0.75 : 1 }}
    >
      <Pressable
        testID={`fee-bill-toggle-${inv.id}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        onPress={onToggle}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12 }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>{inv.termName}</Text>
          <Text style={{ fontSize: 11.5, color: inv.isOverdue ? tokens.color.red : tokens.color.sub, marginTop: 2 }}>
            {inv.isPaid ? `Paid · bill ${inv.number}` : `Due ${fmtDate(inv.dueDate)}${inv.isOverdue ? ' · overdue' : ''}`}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink, fontVariant: ['tabular-nums'] }}>
            {rupees(inv.isPaid ? inv.totalMinor : inv.dueMinor)}
          </Text>
          {/* The late fee gets its own line, never folded into the total:
              "due ₹42,300" hides that ₹1,000 of it is a penalty, and that is
              exactly the number a parent rings the office about. */}
          {inv.lateFeeMinor > 0 && (
            <Text style={{ fontSize: 10.5, color: tokens.color.late, marginTop: 1 }}>
              incl. {rupees(inv.lateFeeMinor)} late fee
            </Text>
          )}
        </View>
        <Text style={{ fontSize: 13, color: tokens.color.sub }}>{isOpen ? '▲' : '▼'}</Text>
      </Pressable>

      {isOpen && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}>
          {inv.lines.map((l, i) => (
            <View key={`${l.categoryName}-${i}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12.5, fontWeight: '600', color: tokens.color.ink }}>
                  {l.categoryName}
                  {!l.isCollectible && (
                    <Text style={{ color: tokens.color.green, fontWeight: '700' }}> · not charged to you</Text>
                  )}
                </Text>
                {l.categoryDescription !== '' && (
                  <Text style={{ fontSize: 11, color: tokens.color.sub, marginTop: 1, lineHeight: 15 }}>
                    {l.categoryDescription}
                  </Text>
                )}
                {l.concessionMinor > 0 && (
                  <Text style={{ fontSize: 11, color: tokens.color.green, marginTop: 1 }}>
                    −{rupees(l.concessionMinor)}
                    {l.concessionReason !== null ? ` · ${l.concessionReason}` : ''}
                  </Text>
                )}
              </View>
              <Text style={{ fontSize: 12.5, color: tokens.color.ink, fontVariant: ['tabular-nums'] }}>
                {rupees(l.netMinor)}
              </Text>
            </View>
          ))}

          <View style={{ height: 1, backgroundColor: tokens.color.line }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 12.5, color: tokens.color.sub }}>Bill total</Text>
            <Text style={{ fontSize: 12.5, fontWeight: '700', color: tokens.color.ink, fontVariant: ['tabular-nums'] }}>
              {rupees(inv.totalMinor)}
            </Text>
          </View>
          {inv.paidMinor > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12.5, color: tokens.color.sub }}>Already paid</Text>
              <Text style={{ fontSize: 12.5, color: tokens.color.green, fontVariant: ['tabular-nums'] }}>
                −{rupees(inv.paidMinor)}
              </Text>
            </View>
          )}
          {inv.lateFeeMinor > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12.5, color: tokens.color.late }}>Late fee</Text>
              <Text style={{ fontSize: 12.5, color: tokens.color.late, fontVariant: ['tabular-nums'] }}>
                {rupees(inv.lateFeeMinor)}
              </Text>
            </View>
          )}

          {!inv.isPaid && canPayByTransfer && (
            <Pressable
              testID={`fee-bill-pay-${inv.id}`}
              accessibilityRole="button"
              onPress={onPay}
              style={{
                marginTop: 4, backgroundColor: tokens.color.indigo, borderRadius: 11,
                paddingVertical: 10, alignItems: 'center',
              }}
            >
              <Text style={{ color: tokens.color.onBrand, fontSize: 13, fontWeight: '700' }}>
                Pay {rupees(inv.dueMinor)}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Send the money, then tell the school. Deliberately two steps — the same
 * shape as the web portal, because the app cannot know a transfer happened
 * and must not imply it did.
 */
function PayByTransfer({
  invoice, onClose, onDone,
}: {
  invoice: StudentFeeInvoice;
  onClose: () => void;
  onDone: () => void;
}) {
  const tokens = useTokens();
  const [bank, setBank] = useState<BankInstructions | null>(null);
  const [method, setMethod] = useState<FeePaymentMethod>('UPI');
  const [amount, setAmount] = useState(String(invoice.dueMinor / 100));
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void api.request<BankInstructions>(`/me/fees/bank-instructions?invoiceId=${invoice.id}`)
        .then((b) => { if (!cancelled) setBank(b); })
        .catch(() => undefined);
      return () => { cancelled = true; };
    }, [invoice.id]),
  );

  async function pickProof() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (res.canceled || !res.assets?.length) return;
    setProof(res.assets[0]);
  }

  async function submit() {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const form = new FormData();
      // SubmitPaymentDto requires studentId even here, where the server ignores
      // it and resolves the child from the JWT. Omitting it is a 400 before the
      // controller is ever reached — the web portal sends the same placeholder.
      form.append('studentId', '00000000-0000-0000-0000-000000000000');
      form.append('invoiceId', invoice.id);
      form.append('method', method);
      // Rupees in the box, paise on the wire — the same single conversion the
      // rest of the app uses. Multipart sends everything as a string; the DTO
      // coerces with @Type(() => Number).
      form.append('amountMinor', String(Math.round(Number(amount.replace(/[^0-9.]/g, '')) * 100)));
      form.append('paidOn', new Date().toISOString().slice(0, 10));
      // `reference`, not `providerRef` — the DTO's name for the UTR.
      if (reference.trim()) form.append('reference', reference.trim());
      if (proof) {
        form.append('file', {
          uri: proof.uri,
          name: proof.fileName ?? 'proof.jpg',
          type: proof.mimeType ?? 'image/jpeg',
        } as unknown as Blob);
      }
      await api.upload('/me/fees/submit', form);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not send this to the school — try again.');
    } finally {
      setBusy(false);
    }
  }

  const b = bank?.bank;

  return (
    <Card testID="fee-pay-sheet" style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 14, fontFamily: font.serif, fontWeight: '600', color: tokens.color.ink }}>
          Pay {invoice.termName}
        </Text>
        <Pressable testID="fee-pay-close" accessibilityRole="button" onPress={onClose}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: tokens.color.indigo }}>Close</Text>
        </Pressable>
      </View>

      <Text style={{ fontSize: 11.5, color: tokens.color.sub, lineHeight: 16 }}>
        Step 1 — send {rupees(invoice.dueMinor)} to the school. Step 2 — tell them below, so
        the office can match it and send your receipt.
      </Text>

      {/* ── the school's account, long-press to copy ─────────────────────── */}
      {b && (
        <View style={{ backgroundColor: tokens.color.surfaceMuted, borderRadius: 11, padding: 11, gap: 3 }}>
          <Field k="Account name" v={b.accountName} />
          <Field k="Account no." v={b.accountNumber} />
          <Field k="IFSC" v={b.ifsc} />
          <Field k="Bank" v={b.branch ? `${b.bankName} · ${b.branch}` : b.bankName} />
          {b.upiId && <Field k="UPI ID" v={b.upiId} />}
          {b.instructions && (
            <Text style={{ fontSize: 11, color: tokens.color.sub, marginTop: 4, lineHeight: 15 }}>
              {b.instructions}
            </Text>
          )}
          {b.upiIntentUri && (
            <Pressable
              testID="fee-pay-upi"
              accessibilityRole="button"
              onPress={() => { void Linking.openURL(b.upiIntentUri as string); }}
              style={{
                marginTop: 6, backgroundColor: tokens.color.indigo, borderRadius: 10,
                paddingVertical: 9, alignItems: 'center',
              }}
            >
              <Text style={{ color: tokens.color.onBrand, fontSize: 12.5, fontWeight: '700' }}>
                Open a UPI app
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* ── step 2: the claim ────────────────────────────────────────────── */}
      <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: tokens.color.sub, marginTop: 2 }}>
        Tell the school you have paid
      </Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {METHODS.map((m) => (
          <Pressable
            key={m}
            testID={`fee-pay-method-${m}`}
            accessibilityRole="button"
            accessibilityState={{ selected: method === m }}
            onPress={() => setMethod(m)}
            style={{
              paddingHorizontal: 11, paddingVertical: 6, borderRadius: tokens.radius.chip,
              borderWidth: 1,
              borderColor: method === m ? tokens.color.indigo : tokens.color.line,
              backgroundColor: method === m ? tokens.color.indigo50 : 'transparent',
            }}
          >
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: method === m ? tokens.color.indigo : tokens.color.sub }}>
              {METHOD_LABEL[m]}
            </Text>
          </Pressable>
        ))}
      </View>

      <Labelled label="Amount sent">
        <TextInput
          testID="fee-pay-amount"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={tokens.color.placeholder}
          style={inputStyle(tokens)}
        />
      </Labelled>

      <Labelled label={method === 'CASH' ? 'Receipt number (if you have one)' : 'UPI reference / UTR'}>
        <TextInput
          testID="fee-pay-reference"
          value={reference}
          onChangeText={setReference}
          autoCapitalize="characters"
          placeholder="e.g. 412345678901"
          placeholderTextColor={tokens.color.placeholder}
          style={inputStyle(tokens)}
        />
      </Labelled>

      <Pressable
        testID="fee-pay-proof"
        accessibilityRole="button"
        onPress={() => void pickProof()}
        style={{
          borderWidth: 1, borderColor: tokens.color.line, borderRadius: 11,
          paddingVertical: 10, alignItems: 'center', borderStyle: 'dashed',
        }}
      >
        <Text style={{ fontSize: 12.5, fontWeight: '700', color: tokens.color.indigo }}>
          {proof ? 'Screenshot attached — tap to change' : 'Attach a screenshot (optional)'}
        </Text>
      </Pressable>

      {err !== null && <Toast kind="error" message={err} />}

      <Pressable
        testID="fee-pay-submit"
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void submit()}
        style={{
          backgroundColor: busy ? tokens.color.line : tokens.color.indigo,
          borderRadius: 11, paddingVertical: 11, alignItems: 'center',
        }}
      >
        <Text style={{ color: tokens.color.onBrand, fontSize: 13, fontWeight: '700' }}>
          {busy ? 'Sending…' : 'I have paid'}
        </Text>
      </Pressable>

      {/* Says what actually happens. The module sends NO message — the receipt
          appears on this screen and nowhere else — and copy that promised one
          would have families waiting on a notification that never arrives. */}
      <Text style={{ fontSize: 10.5, color: tokens.color.sub, lineHeight: 15 }}>
        The school checks this, usually within a working day. Your receipt appears on this
        screen once they confirm it.
      </Text>
    </Card>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  const tokens = useTokens();
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Text style={{ fontSize: 11.5, color: tokens.color.sub, width: 96 }}>{k}</Text>
      {/* Selectable so a parent can long-press and copy the account number
          into their bank app — there is no clipboard dependency in this app,
          and re-typing an IFSC from a screen is how money reaches the wrong
          account. */}
      <Text selectable style={{ fontSize: 11.5, fontWeight: '700', color: tokens.color.ink, flex: 1, fontFamily: font.mono }}>
        {v}
      </Text>
    </View>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  const tokens = useTokens();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: tokens.color.sub }}>{label}</Text>
      {children}
    </View>
  );
}

function inputStyle(tokens: ReturnType<typeof useTokens>) {
  return {
    borderWidth: 1,
    borderColor: tokens.color.line,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 13,
    color: tokens.color.ink,
    backgroundColor: tokens.color.surface,
  };
}
