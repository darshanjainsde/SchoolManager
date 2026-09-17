import { useState } from 'react';
import { Animated, Text, View } from 'react-native';
import { ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { rupees } from '@/lib/money';
import { formatDate } from '@/lib/portal';
import {
  METHOD_LABEL, STATUS_LABEL, STATUS_TONE, nextDue, totalDueMinor,
  type FeeInvoice, type FeePaymentRow, type HowToPay, type StudentFees,
} from '@/lib/fees';
import { Card, Empty, ErrorState, Figure, Page, PageHeader, Pill, Screen, SectionTitle, Toast } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { PaySheet } from '@/components/PaySheet';
import { Touchable } from '@/components/Touchable';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';
import { DUR, stampStyle, useGesture } from '@/theme/motion';

/** Whole days between today and an ISO date; negative when it has passed. */
function daysUntil(iso: string): number {
  const target = new Date(iso);
  const t = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const now = new Date();
  const n = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((t - n) / 86_400_000);
}

/** The one line under the big figure: when, or how late. */
function dueHint(inv: FeeInvoice): string {
  const d = daysUntil(inv.dueDate);
  if (d < 0) return `Due ${formatDate(inv.dueDate)} · ${-d} day${d === -1 ? '' : 's'} late`;
  if (d === 0) return 'Due today';
  return `Due ${formatDate(inv.dueDate)}`;
}

/**
 * THE FEES TAB — what do I owe and what is it for, how do I pay it, and
 * where has my payment got to. The web portal's page, on paper.
 *
 * Every bill line carries the sentence the school wrote in setup: "Exam
 * ₹800" starts an argument, "Exam ₹800 — question papers, answer sheets and
 * result processing" ends one. The red margin rule appears only when a bill
 * is actually late; the stamp lands only on money the office has confirmed.
 */
export default function Fees() {
  const tokens = useTokens();
  const fees = useQuery<StudentFees>('/me/fees');
  const how = useQuery<HowToPay>('/me/fees/how-to-pay');
  const [paying, setPaying] = useState<{ invoiceId: string | null; dueMinor: number } | null>(null);
  const [sent, setSent] = useState(false);

  // A 403 is the designed refusal — the school is not on the module.
  if (fees.error instanceof ApiError && fees.error.status === 403 && !fees.data) {
    return (
      <Screen>
        <SectionTitle title="Fees" />
        <Page><Empty icon="fees">Fees are not part of your school’s plan yet.</Empty></Page>
      </Screen>
    );
  }

  const d = fees.data;
  const unpaid = d ? d.invoices.filter((i) => !i.isPaid) : [];
  const pending = d?.payments.find((p) => p.status === 'SUBMITTED') ?? null;
  const owed = d ? totalDueMinor(d) : 0;
  const next = d ? nextDue(d) : null;
  const anyLate = unpaid.some((i) => i.isOverdue);

  return (
    <Screen onRefresh={fees.refresh} refreshing={fees.refreshing}>
      <View style={{ marginHorizontal: 2 }}>
        <Text style={{ fontFamily: font.serif, fontSize: 22, fontWeight: '700', letterSpacing: -0.3, color: tokens.color.ink }}>
          Fees
        </Text>
        {d && (
          <Text style={{ fontSize: 12, color: tokens.color.sub, marginTop: 1 }}>
            {d.student.name} · {d.student.className ?? d.student.admissionNo}
          </Text>
        )}
      </View>

      {sent && (
        <Toast
          kind="success"
          message="Sent to the school. They usually check within a working day."
          actionLabel="OK"
          onAction={() => setSent(false)}
          testID="fees-sent"
        />
      )}

      {fees.loading && <LoadingRows label="Loading your fees…" rows={4} />}
      {fees.error && !d && !(fees.error.status === 403) && <ErrorState error={fees.error} onRetry={fees.reload} />}

      {d && (
        <>
          {/* Where the last claim has got to — the thing a parent opens this tab to check. */}
          {pending && <PendingCard p={pending} />}

          {/* The figure. Red margin only when something is late. */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ position: 'relative' }}>
                {anyLate && (
                  <View
                    testID="fees-late-rule"
                    style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: 2, backgroundColor: tokens.color.marginRed, zIndex: 1 }}
                  />
                )}
                <Figure
                  testID="fees-owed"
                  label={owed > 0 ? 'You owe' : d.balanceMinor < 0 ? 'In credit' : 'Nothing due'}
                  value={owed > 0 ? rupees(owed) : d.balanceMinor < 0 ? rupees(-d.balanceMinor) : rupees(0)}
                  hint={owed > 0 && next ? dueHint(next) : owed > 0 ? undefined : 'Every bill is paid'}
                  tone={anyLate ? 'bad' : owed > 0 ? 'warn' : 'good'}
                />
              </View>
            </View>
            <Figure label="Paid this year" value={rupees(d.paidMinor)} hint={`of ${rupees(d.billedMinor)} billed`} />
          </View>

          {unpaid.map((inv) => (
            <InvoicePage
              key={inv.id}
              inv={inv}
              lateFeeRule={d.lateFeeRule}
              how={how.data}
              onPay={() => setPaying({ invoiceId: inv.id, dueMinor: inv.dueMinor })}
            />
          ))}

          {d.payments.length > 0 && (
            <Page>
              <PageHeader title="Your payments" />
              {d.payments.map((p, i) => (
                <PaymentRow
                  key={p.id}
                  p={p}
                  first={i === 0}
                  onSendAgain={() => setPaying({ invoiceId: null, dueMinor: p.amountMinor })}
                />
              ))}
            </Page>
          )}

          {unpaid.length === 0 && d.payments.length === 0 && (
            <Page><Empty icon="fees">No bills yet. They will appear here when the school issues them.</Empty></Page>
          )}
        </>
      )}

      <PaySheet
        open={paying !== null}
        onClose={() => setPaying(null)}
        invoiceId={paying?.invoiceId ?? null}
        dueMinor={paying?.dueMinor ?? 0}
        onSubmitted={() => {
          setPaying(null);
          setSent(true);
          fees.reload();
        }}
      />
    </Screen>
  );
}

/** The claim waiting on the office, and the three steps it walks. */
function PendingCard({ p }: { p: FeePaymentRow }) {
  const tokens = useTokens();
  return (
    <Card testID="fees-pending" style={{ borderColor: tokens.color.amber, gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 10.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: tokens.color.sub }}>
          Your last payment
        </Text>
        <Pill tone="amber">{STATUS_LABEL.SUBMITTED}</Pill>
      </View>
      <Text style={{ fontFamily: font.mono, fontSize: 16, fontWeight: '700', color: tokens.color.ink }}>
        {rupees(p.amountMinor)}
        <Text style={{ fontFamily: font.sans, fontSize: 12, fontWeight: '500', color: tokens.color.sub }}>
          {'  '}· {METHOD_LABEL[p.method]} · sent {formatDate(p.submittedAt)}
        </Text>
      </Text>
      <Step done label="You told the school" detail={`${formatDate(p.submittedAt)}${p.providerRef ? ` · ${p.providerRef}` : ''}`} />
      <Step now label="Office is checking it" detail="Usually within a working day" />
      <Step label="Confirmed" detail="Your receipt appears here" last />
    </Card>
  );
}

function Step({ label, detail, done, now, last }: { label: string; detail: string; done?: boolean; now?: boolean; last?: boolean }) {
  const tokens = useTokens();
  const dot = done ? tokens.color.green : now ? tokens.color.amber : tokens.color.surface;
  return (
    <View style={{ flexDirection: 'row', gap: 9, minWidth: 0 }}>
      <View style={{ alignItems: 'center', width: 12 }}>
        <View style={{ width: 11, height: 11, borderRadius: 6, marginTop: 3, backgroundColor: dot, borderWidth: 2, borderColor: done ? tokens.color.green : now ? tokens.color.amber : tokens.color.line2 }} />
        {!last && <View style={{ flex: 1, width: 2, minHeight: 12, backgroundColor: tokens.color.line, marginVertical: 2 }} />}
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 8 }}>
        <Text style={{ fontSize: 12.5, fontWeight: '600', color: done || now ? tokens.color.ink : tokens.color.sub }}>{label}</Text>
        <Text style={{ fontSize: 10.5, color: tokens.color.sub, lineHeight: 15 }}>{detail}</Text>
      </View>
    </View>
  );
}

/** One bill: every line with its sentence, the late fee with its rule, the total, and the two rails. */
function InvoicePage({ inv, lateFeeRule, how, onPay }: { inv: FeeInvoice; lateFeeRule: string | null; how: HowToPay | null; onPay: () => void }) {
  const tokens = useTokens();
  return (
    <Page testID={`invoice-${inv.id}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, paddingHorizontal: 12, paddingBottom: 4, gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: font.serif, fontSize: 15, fontWeight: '600', color: tokens.color.ink }} numberOfLines={1}>{inv.termName}</Text>
          <Text style={{ fontFamily: font.mono, fontSize: 10.5, color: tokens.color.sub, marginTop: 1 }}>{inv.number}</Text>
        </View>
        <Pill tone={inv.isOverdue ? 'red' : 'amber'}>{inv.isOverdue ? 'Overdue' : `Due ${formatDate(inv.dueDate)}`}</Pill>
      </View>
      <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 0 }}>
        {inv.lines.map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: tokens.color.line }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>{l.categoryName}</Text>
              <Text style={{ fontSize: 11, color: tokens.color.sub, lineHeight: 15 }}>{l.categoryDescription}</Text>
              {l.concessionReason ? (
                <Text style={{ fontSize: 11, color: tokens.color.green, marginTop: 1 }}>−{rupees(l.concessionMinor)} · {l.concessionReason}</Text>
              ) : null}
            </View>
            <Text style={{ fontFamily: font.mono, fontSize: 13, fontWeight: '600', color: tokens.color.ink }}>{rupees(l.netMinor)}</Text>
          </View>
        ))}
        {inv.lateFeeMinor > 0 && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: tokens.color.line }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.late }}>Late fee</Text>
              {lateFeeRule ? <Text style={{ fontSize: 11, color: tokens.color.sub, lineHeight: 15 }}>{lateFeeRule}</Text> : null}
            </View>
            <Text style={{ fontFamily: font.mono, fontSize: 13, fontWeight: '600', color: tokens.color.late }}>{rupees(inv.lateFeeMinor)}</Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTopWidth: 1.5, borderTopColor: tokens.color.line2, marginTop: 2 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>Due now</Text>
          <Text testID={`invoice-${inv.id}-due`} style={{ fontFamily: font.mono, fontSize: 18, fontWeight: '700', color: inv.isOverdue ? tokens.color.red : tokens.color.ink }}>
            {rupees(inv.dueMinor)}
          </Text>
        </View>
        {inv.paidMinor > 0 && (
          <Text style={{ fontSize: 11, color: tokens.color.green, marginTop: 3 }}>{rupees(inv.paidMinor)} already received against this bill.</Text>
        )}
        {inv.lateFeeMinor === 0 && !inv.isOverdue && lateFeeRule && (
          <Text style={{ fontSize: 11, color: tokens.color.sub, marginTop: 3 }}>Paid after {formatDate(inv.dueDate)}? A late fee of {lateFeeRule.toLowerCase()} applies.</Text>
        )}

        <View style={{ gap: 6, marginTop: 12 }}>
          {how?.canPayByTransfer ? (
            <Touchable testID={`invoice-${inv.id}-pay`} onPress={onPay} accessibilityLabel={`Pay ${rupees(inv.dueMinor)} by bank transfer`}
              style={{ minHeight: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.color.indigo }}>
              <Text style={{ color: tokens.color.onBrand, fontWeight: '700', fontSize: 13.5 }}>Pay by bank transfer</Text>
            </Touchable>
          ) : how ? (
            <Text style={{ fontSize: 12, color: tokens.color.sub, textAlign: 'center' }}>Your school has not published a way to pay yet — please contact the office.</Text>
          ) : null}
          {/* Present but disabled until the school's gateway is live — the
              button never appears from nowhere, and the reason is about the
              school's setup rather than an error. */}
          <View accessibilityState={{ disabled: true }} style={{ minHeight: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.color.surfaceMuted, borderWidth: 1, borderColor: tokens.color.line2 }}>
            <Text style={{ color: tokens.color.sub, fontWeight: '600', fontSize: 13 }}>Pay online</Text>
          </View>
          <Text style={{ fontFamily: font.serif, fontStyle: 'italic', fontSize: 11, color: tokens.color.sub, textAlign: 'center' }}>
            {how?.canPayOnline ? 'Available shortly' : 'Coming once your school is set up for online payment'}
          </Text>
        </View>
      </View>
    </Page>
  );
}

/** One payment in the history; the confirmed ones carry the stamp. */
function PaymentRow({ p, first, onSendAgain }: { p: FeePaymentRow; first: boolean; onSendAgain: () => void }) {
  const tokens = useTokens();
  const verified = p.status === 'VERIFIED';
  return (
    <View testID={`payment-${p.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: first ? 0 : 1, borderTopColor: tokens.color.line }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: font.mono, fontSize: 14, fontWeight: '700', color: tokens.color.ink }}>
          {rupees(p.amountMinor)}
          <Text style={{ fontFamily: font.sans, fontSize: 11.5, fontWeight: '500', color: tokens.color.sub }}>{'  '}· {METHOD_LABEL[p.method]}</Text>
        </Text>
        <Text style={{ fontSize: 11, color: tokens.color.sub, marginTop: 1 }}>
          {formatDate(p.paidOn)}{p.receiptNumber ? ` · receipt ${p.receiptNumber}` : ''}
        </Text>
        {p.rejectionReason ? (
          <>
            <Text style={{ fontSize: 11.5, color: tokens.color.red, marginTop: 3, lineHeight: 16 }}>{p.rejectionReason}</Text>
            <Touchable testID={`payment-${p.id}-again`} onPress={onSendAgain} haptic="none" style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: tokens.color.indigo }}>Send again</Text>
            </Touchable>
          </>
        ) : null}
      </View>
      {verified ? <PaidStamp receipt={p.receiptNumber} /> : <Pill tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Pill>}
    </View>
  );
}

/**
 * THE STAMP — the one gesture that CLOSES work. Lands once when the row
 * mounts confirmed, then simply is the receipt. Never on a reversal: that is
 * bad news, and bad news does not get a flourish.
 */
function PaidStamp({ receipt }: { receipt: string | null }) {
  const tokens = useTokens();
  const v = useGesture(true, DUR.stamp);
  return (
    <Animated.View
      testID="paid-stamp"
      style={[
        stampStyle(v),
        {
          borderWidth: 2,
          borderColor: tokens.color.green,
          borderRadius: 5,
          paddingHorizontal: 8,
          paddingVertical: 3,
          alignItems: 'center',
        },
      ]}
    >
      <Text style={{ fontFamily: font.serif, fontSize: 13, fontWeight: '700', letterSpacing: 1.5, color: tokens.color.green }}>PAID</Text>
      {receipt ? <Text style={{ fontFamily: font.mono, fontSize: 8, letterSpacing: 0.5, color: tokens.color.green, opacity: 0.85 }}>{receipt}</Text> : null}
    </Animated.View>
  );
}
