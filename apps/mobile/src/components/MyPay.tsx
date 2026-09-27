import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { Empty, ErrorState, Figure, Page, PageHeader, Pill, Screen, SectionTitle } from '@/components/ui';
import { Button, Row } from '@/components/desk';
import { LoadingRows } from '@/components/Loading';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { isPayslipDoc, payslipFileName, payslipHtml, type PayslipDoc } from '@skoolos/types';
import { PayDetails } from '@/components/PayDetails';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

export interface PayLine { key: string; name: string; kind: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_COST'; amountMinor: number; order: number }
export interface MySlip {
  id: string; name: string; designation: string | null; lines: PayLine[];
  daysInMonth: number; daysPaid: number;
  grossMinor: number; deductionMinor: number; netMinor: number; employerCostMinor: number;
  incomeTaxMinor: number; ytdGrossMinor: number; ytdTaxMinor: number; taxRegime: 'NEW' | 'OLD';
  payRun: { periodYear: number; periodMonth: number; status: string; paidAt: string | null };
}
export interface MyPayPayload {
  currency: string; personKind: 'TEACHER' | 'STAFF'; taxYear: number; taxYearLabel: string;
  regimes: { key: 'NEW' | 'OLD'; label: string }[];
  defaultRegime: 'NEW' | 'OLD';
  declaration: { status: 'DRAFT' | 'SUBMITTED' } | null;
  payslips: MySlip[];
  empty: boolean;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m: number) => MONTHS[m - 1] ?? String(m);

/** Paise → "₹37,600". Indian grouping, paise only when there are any. */
export function rupees(minor: number): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const paise = abs % 100;
  const grouped = whole.toLocaleString('en-IN');
  return `${neg ? '−' : ''}₹${paise === 0 ? grouped : `${grouped}.${String(paise).padStart(2, '0')}`}`;
}

/**
 * MY PAY — the same screen for a teacher and for a driver, because the
 * question is the same one: what reached my bank, and why is it that number.
 *
 * Only LOCKED months reach here (the server will not send a draft), and the
 * newest is open by default: on the last day of the month a person opens this
 * for exactly one figure, and making them tap to find it is the wrong default.
 *
 * The employer's own contribution gets its own block. Most payslips leave it
 * out, so a teacher reads their pay as smaller than the job actually is;
 * showing it is the cheapest honesty in the product.
 */
export function MyPay({ title = 'My pay' }: { title?: string }) {
  const tokens = useTokens();
  const q = useQuery<MyPayPayload>('/me/pay');
  const [openId, setOpenId] = useState<string | null>(null);
  const d = q.data;
  const open = useMemo(
    () => (openId ? d?.payslips.find((p) => p.id === openId) ?? null : d?.payslips[0] ?? null),
    [d, openId],
  );

  // A school without the module answers 403/404, which is not an error the
  // person can do anything about — it is a room their school has not opened.
  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404) && !d) {
    return (
      <Screen>
        <SectionTitle title={title} />
        <Page><Empty icon="fees">Your school does not keep pay in Sckools yet.</Empty></Page>
      </Screen>
    );
  }

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <SectionTitle title={title} />
      {q.loading && !d && <LoadingRows label="Fetching your payslips…" rows={3} />}
      {q.error && !d && <ErrorState error={q.error} onRetry={q.reload} />}

      {d?.empty && (
        <Page>
          <Empty icon="fees">No payslip yet. One appears here the month your school finishes its first pay run.</Empty>
        </Page>
      )}

      {open && (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Figure
              testID="pay-net"
              label="Paid to you"
              value={rupees(open.netMinor)}
              hint={`${monthName(open.payRun.periodMonth)} ${open.payRun.periodYear}`}
              tone="good"
            />
            <Figure
              testID="pay-gross"
              label="Earned"
              value={rupees(open.grossMinor)}
              hint={open.daysPaid === open.daysInMonth ? 'full month' : `${open.daysPaid} of ${open.daysInMonth} days`}
            />
          </View>

          <Ledger title="Earned" icon="fees" lines={open.lines.filter((l) => l.kind === 'EARNING')} total={open.grossMinor} totalLabel="Gross" />
          <Ledger title="Taken off" icon="report" lines={open.lines.filter((l) => l.kind === 'DEDUCTION')} total={open.deductionMinor} totalLabel="Deductions" />

          {open.lines.some((l) => l.kind === 'EMPLOYER_COST') && (
            <Page testID="pay-employer">
              <PageHeader title="Your school also paid in" icon="assignments" />
              {open.lines.filter((l) => l.kind === 'EMPLOYER_COST').map((l, i) => (
                <Row key={l.key} first={i === 0} title={l.name} right={<Text style={{ fontFamily: font.mono, fontSize: 13.5, color: tokens.color.ink }}>{rupees(l.amountMinor)}</Text>} />
              ))}
              <Text style={{ paddingHorizontal: 12, paddingVertical: 10, fontSize: 11.5, lineHeight: 17, color: tokens.color.sub }}>
                This is on top of your pay, not out of it. It goes to the provident fund in your name.
              </Text>
            </Page>
          )}

          <SharePayslip payslipId={open.id} />

          <Page>
            <PageHeader title="This year" icon="results" />
            <Row first title="Earned so far" right={<Text style={{ fontFamily: font.mono, color: tokens.color.ink }}>{rupees(open.ytdGrossMinor)}</Text>} />
            <Row title="Tax so far" sub={open.taxRegime === 'NEW' ? 'new tax regime' : 'old tax regime'} right={<Text style={{ fontFamily: font.mono, color: tokens.color.ink }}>{rupees(open.ytdTaxMinor)}</Text>} />
            {d?.declaration ? (
              <Row title="Tax declaration" sub={d.taxYearLabel} right={<Pill tone={d.declaration.status === 'SUBMITTED' ? 'green' : 'amber'}>{d.declaration.status === 'SUBMITTED' ? 'Sent' : 'Draft'}</Pill>} />
            ) : (
              <Row title="Tax declaration" sub={`${d?.taxYearLabel ?? ''} — rent, savings, a previous job`} right={<Pill tone="neutral">Not sent</Pill>} />
            )}
            <Text style={{ paddingHorizontal: 12, paddingVertical: 10, fontSize: 11.5, lineHeight: 17, color: tokens.color.sub }}>
              The declaration is filled in on the school&rsquo;s website, where there is room for the proofs.
            </Text>
          </Page>
        </>
      )}

      {d && d.payslips.length > 1 && (
        <Page testID="pay-months">
          <PageHeader title="Earlier months" icon="timetable" />
          {d.payslips.map((p, i) => (
            <Row
              key={p.id}
              first={i === 0}
              testID={`payslip-${p.id}`}
              title={`${monthName(p.payRun.periodMonth)} ${p.payRun.periodYear}`}
              sub={p.daysPaid === p.daysInMonth ? 'full month' : `${p.daysPaid} of ${p.daysInMonth} days`}
              right={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontFamily: font.mono, fontWeight: '700', color: tokens.color.ink }}>{rupees(p.netMinor)}</Text>
                  {open?.id === p.id ? <Pill tone="indigo">Open</Pill> : null}
                </View>
              }
              onPress={() => setOpenId(p.id)}
            />
          ))}
        </Page>
      )}

      {/* The same rows the office writes — a driver with no laptop can put
          their own account in, and the school's "no bank account" exception
          clears the moment they do. */}
      <PayDetails />
    </Screen>
  );
}

function Ledger({ title, icon, lines, total, totalLabel }: { title: string; icon: 'fees' | 'report'; lines: PayLine[]; total: number; totalLabel: string }) {
  const tokens = useTokens();
  if (lines.length === 0) return null;
  return (
    <Page testID={`pay-${title.toLowerCase().replace(/\s/g, '-')}`}>
      <PageHeader title={title} icon={icon} />
      {lines.map((l, i) => (
        <Row key={l.key} first={i === 0} title={l.name} right={<Text style={{ fontFamily: font.mono, fontSize: 13.5, color: tokens.color.ink }}>{rupees(l.amountMinor)}</Text>} />
      ))}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: tokens.color.line2 }}>
        <Text style={{ fontWeight: '700', fontSize: 13.5, color: tokens.color.ink }}>{totalLabel}</Text>
        <Text style={{ fontFamily: font.mono, fontWeight: '700', fontSize: 13.5, color: tokens.color.ink }}>{rupees(total)}</Text>
      </View>
    </Page>
  );
}

/**
 * THE PAYSLIP AS A PDF, on the phone.
 *
 * Printed from the SAME document the web prints and the office prints — the
 * server builds one payslip for everybody, so what a teacher sends to a bank
 * from their phone is what the school has on file.
 *
 * Nothing leaves the phone until the person taps Share.
 */
function SharePayslip({ payslipId }: { payslipId: string }) {
  const tokens = useTokens();
  const q = useQuery<PayslipDoc>(`/me/pay/payslips/${payslipId}/document`);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // An older API has no such route. Better to show nothing than a button
  // that cannot work.
  if (!isPayslipDoc(q.data)) return null;
  const doc = q.data;

  async function share() {
    setBusy(true);
    setProblem(null);
    try {
      const { uri } = await Print.printToFileAsync({ html: payslipHtml(doc) });
      if (!(await Sharing.isAvailableAsync())) {
        setProblem('Sharing isn\u2019t available on this phone.');
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: payslipFileName(doc),
        UTI: 'com.adobe.pdf',
      });
    } catch {
      setProblem('Could not make the PDF \u2014 try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page testID="pay-share">
      <PageHeader title="Keep a copy" icon="fees" />
      <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}>
        <Text style={{ fontSize: 12, lineHeight: 18, color: tokens.color.sub }}>
          A PDF of this payslip \u2014 the same one your school has on file. Banks and landlords ask for it.
        </Text>
        <Button label={busy ? 'Making the PDF\u2026' : 'Save or share the PDF'} onPress={() => void share()} disabled={busy} testID="pay-share-pdf" />
        {problem ? <Text style={{ fontSize: 12, color: tokens.color.red }}>{problem}</Text> : null}
      </View>
    </Page>
  );
}
