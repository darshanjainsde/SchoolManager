import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { METHOD_LABEL, fmtDate, rupees, type FeeReceiptDocument } from '@/lib/fees';
import { Card, Page, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/**
 * ONE RECEIPT, ON THE PHONE.
 *
 * Rendered as a document rather than as another list row: a receipt is the
 * thing a family shows to a scholarship office, a landlord or the next school,
 * so it carries the letterhead, the admission number, what the money cleared,
 * and the confirmation line — everything the printed web copy carries.
 *
 * Deliberately NOT the web sheet's A5 geometry. Millimetres on a phone would
 * force a horizontal scroll on a document people read one-handed; this is the
 * same INFORMATION laid out for the screen it is on. Both are fed by the same
 * `/me/fees/receipts/:id` payload, so they cannot disagree about a rupee.
 */
export default function FamilyReceiptScreen(): React.JSX.Element {
  const tokens = useTokens();
  const { paymentId } = useLocalSearchParams<{ paymentId: string }>();
  const [r, setR] = useState<FeeReceiptDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      void api.request<FeeReceiptDocument>(`/me/fees/receipts/${paymentId}`)
        .then((d) => { if (!cancelled) setR(d); })
        .catch((e: unknown) => {
          if (cancelled) return;
          // 404 covers two honest cases — no receipt issued yet, and a receipt
          // that is not this family's. Neither should read like a crash.
          setError(
            e instanceof ApiError && e.status === 404
              ? 'No receipt has been issued for this payment yet. One appears here once the school has confirmed the money.'
              : e instanceof ApiError ? e.message : 'Something went wrong.',
          );
        });
      return () => { cancelled = true; };
    }, [paymentId]),
  );

  if (error !== null) {
    return (
      <Screen>
        <SectionTitle title="Receipt" />
        <Card><Text style={{ fontSize: 13, color: tokens.color.sub, lineHeight: 19 }}>{error}</Text></Card>
      </Screen>
    );
  }

  if (r === null) {
    return (
      <Screen>
        <SectionTitle title="Receipt" />
        <LoadingRows label="Loading your receipt…" rows={3} />
      </Screen>
    );
  }

  const allocated = r.allocations.reduce((a, x) => a + x.amountMinor, 0);
  const total = allocated + r.unallocatedMinor;

  return (
    <Screen>
      <SectionTitle title="Receipt" />

      <Page testID="fee-receipt">
        {/* ── letterhead ────────────────────────────────────────────────── */}
        <View style={{ alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: tokens.color.ink }}>
          <Text style={{ fontSize: 16, fontFamily: font.serif, fontWeight: '600', color: tokens.color.ink, textAlign: 'center' }}>
            {r.school.name}
          </Text>
          {r.school.addressLines.map((l) => (
            <Text key={l} style={{ fontSize: 11, color: tokens.color.sub, textAlign: 'center', marginTop: 1 }}>{l}</Text>
          ))}
          {(r.school.phone !== null || r.school.email !== null) && (
            <Text style={{ fontSize: 11, color: tokens.color.sub, textAlign: 'center', marginTop: 1 }}>
              {[r.school.phone, r.school.email].filter(Boolean).join(' · ')}
            </Text>
          )}
          <Text style={{ fontSize: 10.5, fontWeight: '700', letterSpacing: 1.6, color: tokens.color.ink, marginTop: 10 }}>
            FEE RECEIPT
          </Text>
        </View>

        {/* ── number + date ─────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingHorizontal: 16, paddingTop: 12 }}>
          <Text style={{ fontSize: 11.5, color: tokens.color.sub }}>
            Receipt no.{' '}
            <Text selectable style={{ fontWeight: '700', color: tokens.color.ink, fontFamily: font.mono }}>
              {r.receiptNumber}
            </Text>
          </Text>
          <Text style={{ fontSize: 11.5, color: tokens.color.sub }}>
            Issued <Text style={{ fontWeight: '700', color: tokens.color.ink }}>{fmtDate(r.issuedAt)}</Text>
          </Text>
        </View>

        {/* ── who ───────────────────────────────────────────────────────── */}
        <View style={{ margin: 16, marginBottom: 0, borderWidth: 1, borderColor: tokens.color.line, borderRadius: 11, padding: 12 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: tokens.color.ink }}>{r.student.name}</Text>
          <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>
            Admission no. {r.student.admissionNo}
            {r.student.className !== null ? ` · Class ${r.student.className}` : ''}
          </Text>
        </View>

        {/* ── what the money cleared ────────────────────────────────────── */}
        <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: tokens.color.sub, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: tokens.color.ink }}>
            Received towards
          </Text>

          {r.allocations.map((a, i) => (
            <View
              key={`${a.invoiceNumber}-${a.categoryName}-${i}`}
              style={{ flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: tokens.color.line }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12.5, color: tokens.color.ink }}>{a.categoryName}</Text>
                <Text style={{ fontSize: 10.5, color: tokens.color.sub, marginTop: 1 }}>
                  {a.termName} · bill {a.invoiceNumber}
                </Text>
              </View>
              <Text style={{ fontSize: 12.5, color: tokens.color.ink, fontVariant: ['tabular-nums'] }}>
                {rupees(a.amountMinor)}
              </Text>
            </View>
          ))}

          {/* Shown, not dropped — so the lines add up to what was received. */}
          {r.unallocatedMinor !== 0 && (
            <View style={{ flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: tokens.color.line }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12.5, color: tokens.color.ink }}>Advance held against future bills</Text>
                <Text style={{ fontSize: 10.5, color: tokens.color.sub, marginTop: 1 }}>Not applied to any bill yet</Text>
              </View>
              <Text style={{ fontSize: 12.5, color: tokens.color.ink, fontVariant: ['tabular-nums'] }}>
                {rupees(r.unallocatedMinor)}
              </Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 10, paddingTop: 10 }}>
            <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: tokens.color.ink }}>Total received</Text>
            <Text testID="fee-receipt-total" style={{ fontSize: 14, fontWeight: '700', color: tokens.color.ink, fontVariant: ['tabular-nums'] }}>
              {rupees(total)}
            </Text>
          </View>
        </View>

        {/* ── how ───────────────────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 3 }}>
          <Row k="Paid by" v={METHOD_LABEL[r.payment.method]} />
          <Row k="Paid on" v={fmtDate(r.payment.paidOn)} />
          {r.payment.providerRef !== null && <Row k="Reference" v={r.payment.providerRef} mono />}
        </View>

        {/* ── the school's own words ────────────────────────────────────── */}
        {r.payment.ackNote !== null && (
          <View style={{ marginHorizontal: 16, marginTop: 14, borderLeftWidth: 2, borderLeftColor: tokens.color.ink, paddingLeft: 10 }}>
            <Text style={{ fontSize: 9.5, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: tokens.color.sub, marginBottom: 3 }}>
              Note from the school
            </Text>
            <Text style={{ fontSize: 12.5, color: tokens.color.ink, lineHeight: 18 }}>{r.payment.ackNote}</Text>
          </View>
        )}

        <View style={{ padding: 16, paddingTop: 16 }}>
          <Text style={{ fontSize: 10, color: tokens.color.sub, lineHeight: 14 }}>
            Computer-generated receipt. Valid without a signature.
            {r.payment.verifiedAt !== null
              ? ` Confirmed by the school office on ${fmtDate(r.payment.verifiedAt)}.`
              : ''}
          </Text>
        </View>
      </Page>
    </Screen>
  );
}

function Row({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  const tokens = useTokens();
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Text style={{ fontSize: 11.5, color: tokens.color.sub, width: 86 }}>{k}</Text>
      <Text
        selectable={mono}
        style={{ fontSize: 11.5, color: tokens.color.ink, flex: 1, fontFamily: mono ? font.mono : undefined }}
      >
        {v}
      </Text>
    </View>
  );
}
