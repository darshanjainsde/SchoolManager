import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { receiptHtml, type FeeReceiptDoc } from '@skoolos/types';
import { useQuery } from '@/lib/query';
import { formatDate } from '@/lib/portal';
import { rupees } from '@/lib/money';
import { METHOD_LABEL, type FeePaymentMethod } from '@/lib/fees';
import { ErrorState, Page, Screen, Toast } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';
import { DUR, stampStyle, useGesture } from '@/theme/motion';
import { Animated } from 'react-native';

/**
 * ONE RECEIPT — the same document the web prints, drawn on paper here and
 * printed to a PDF on the phone for Share. Nothing is sent anywhere until
 * the family shares it.
 */
export default function Receipt() {
  const tokens = useTokens();
  const { paymentId } = useLocalSearchParams<{ paymentId: string }>();
  const q = useQuery<FeeReceiptDoc>(paymentId ? `/me/fees/receipts/${paymentId}` : null);
  const [sharing, setSharing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const stamp = useGesture(!!q.data, DUR.stamp);

  async function share() {
    if (!q.data) return;
    setSharing(true);
    setProblem(null);
    try {
      const { uri } = await Print.printToFileAsync({ html: receiptHtml(q.data) });
      if (!(await Sharing.isAvailableAsync())) {
        setProblem('Sharing isn’t available on this phone.');
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Receipt ${q.data.number}`, UTI: 'com.adobe.pdf' });
    } catch {
      setProblem('Could not make the PDF — try again.');
    } finally {
      setSharing(false);
    }
  }

  const r = q.data;
  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      {q.loading && <LoadingRows label="Opening the receipt…" rows={4} />}
      {q.error && !r && <ErrorState error={q.error} onRetry={q.reload} />}
      {r && (
        <>
          <Page testID="receipt" style={{ paddingHorizontal: 16, paddingVertical: 18, alignItems: 'center', gap: 6 }}>
            <Text style={{ fontFamily: font.serif, fontSize: 18, fontWeight: '700', color: tokens.color.ink, textAlign: 'center' }}>{r.school.name}</Text>
            <Text style={{ fontSize: 10.5, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: tokens.color.sub }}>Fee receipt</Text>
            <Animated.View style={[stampStyle(stamp), { marginTop: 10, borderWidth: 3, borderColor: tokens.color.green, borderRadius: 6, paddingHorizontal: 16, paddingVertical: 5 }]}>
              <Text style={{ fontFamily: font.serif, fontSize: 20, fontWeight: '700', letterSpacing: 3, color: tokens.color.green }}>PAID</Text>
            </Animated.View>
            <Text style={{ fontFamily: font.mono, fontSize: 28, fontWeight: '700', color: tokens.color.ink, marginTop: 10 }}>{rupees(r.amountMinor)}</Text>
            <View style={{ alignSelf: 'stretch', marginTop: 12, borderTopWidth: 1, borderTopColor: tokens.color.line }}>
              <Fact label="Receipt no." value={r.number} />
              <Fact label="Received from" value={`${r.student.name}${r.student.className ? ` · ${r.student.className}` : ''} · Adm. ${r.student.admissionNo}`} />
              {r.termName ? <Fact label="Towards" value={`${r.termName}${r.invoiceNumber ? ` · ${r.invoiceNumber}` : ''}`} /> : null}
              <Fact label="Paid on" value={`${formatDate(r.paidOn)} · ${METHOD_LABEL[r.method as FeePaymentMethod] ?? r.method}${r.providerRef ? ` · ref ${r.providerRef}` : ''}`} />
              <Fact label="Confirmed" value={r.verifiedAt ? formatDate(r.verifiedAt) : '—'} />
            </View>
            <Text style={{ fontSize: 10, color: tokens.color.sub, textAlign: 'center', marginTop: 8 }}>Issued {formatDate(r.issuedAt)} · valid without a signature</Text>
          </Page>
          <Pressable
            testID="receipt-share"
            accessibilityRole="button"
            accessibilityState={{ disabled: sharing }}
            disabled={sharing}
            onPress={() => void share()}
            style={({ pressed }) => ({ minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.color.indigo, opacity: sharing ? 0.6 : pressed ? 0.8 : 1 })}
          >
            <Text style={{ color: tokens.color.onBrand, fontWeight: '700', fontSize: 14 }}>{sharing ? 'Making the PDF…' : 'Share as PDF'}</Text>
          </Pressable>
          <Text style={{ fontFamily: font.serif, fontStyle: 'italic', fontSize: 11.5, color: tokens.color.sub, textAlign: 'center' }}>Made on this phone. Nothing is sent anywhere until you share it.</Text>
          {problem && <Toast kind="error" message={problem} testID="receipt-share-error" />}
        </>
      )}
    </Screen>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const tokens = useTokens();
  return (
    <View style={{ flexDirection: 'row', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: tokens.color.line }}>
      <Text style={{ width: 92, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: tokens.color.sub, paddingTop: 2 }}>{label}</Text>
      <Text style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: tokens.color.ink, lineHeight: 17 }}>{value}</Text>
    </View>
  );
}
