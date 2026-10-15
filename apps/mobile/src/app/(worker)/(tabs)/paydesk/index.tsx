import { Text, View } from 'react-native';
import { ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { rupees } from '@/components/MyPay';
import { Empty, ErrorState, Page, PageHeader, Pill, Screen, SectionTitle } from '@/components/ui';
import { Row } from '@/components/desk';
import { Icon, type IconName } from '@/components/icons';
import { LoadingRows } from '@/components/Loading';
import { NotificationBell } from '@/components/NotificationBell';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface Overview {
  setup: { ready: boolean; onPay: number; rosterSize: number; gradeCount: number };
  period: { year: number; month: number };
  run: { status: string } | null;
  cost: { estimated: boolean; headcount: number; netMinor: number; employerCostMinor: number; totalCostMinor: number };
  exceptions: { kind: string; count: number; label: string }[];
}

/**
 * THE ACCOUNTS DESK — what the month costs, and what is waiting on somebody.
 *
 * Read-only on purpose. Opening a pay run, working it out and locking it is a
 * sitting-down job with a register and a bank file beside it, and it stays on
 * the web — the same line the library's Settings draws. What belongs on a
 * phone is the answer to "where are we" and "what needs me", which is what an
 * accounts officer is actually asked while standing in a corridor.
 */
export default function PayDesk() {
  const tokens = useTokens();
  const q = useQuery<Overview>('/payroll/overview');

  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404)) {
    return (
      <Screen>
        <SectionTitle title="Pay" />
        <Page>
          <Empty kind="locked" title="Pay opens when the admin allows it">
            Payroll for the school shows here once the admin grants you Pay under Settings → Pay. You get a bell when it is on.
          </Empty>
        </Page>
        {/* A locked door still shows what is behind it (empty-state kind
            "locked", v2 2026-10-08): the page is not 80% blank, and the
            officer knows what to ask the admin for. */}
        <Page testID="paydesk-preview">
          <PageHeader title="What Pay shows" icon="fees" />
          {[
            ['fees', 'The month in one figure', 'What the school pays this month, by grade, and whether it is worked out yet'],
            ['requests', 'Leave that changes pay', 'Every undecided leave is listed before the month can close'],
            ['person', 'Each person\u2019s payslip', 'Basic, allowances, deductions and the net, as it will be paid'],
          ].map(([icon, title, sub], i) => (
            <View key={title} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, paddingVertical: 8, paddingHorizontal: 16, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: tokens.color.line }}>
              <View style={{ width: 40, height: 40, borderRadius: tokens.radius.field, backgroundColor: tokens.color.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={icon as IconName} size={20} color={tokens.color.sub} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: tokens.color.ink }}>{title}</Text>
                <Text style={{ fontSize: 13, lineHeight: 18, color: tokens.color.sub }}>{sub}</Text>
              </View>
            </View>
          ))}
        </Page>
      </Screen>
    );
  }
  if (q.error) return <Screen><SectionTitle title="Pay" /><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  if (!q.data) return <Screen><SectionTitle title="Pay" /><Page><LoadingRows label="this month" /></Page></Screen>;

  const d = q.data;
  const label = `${MONTHS[d.period.month - 1]} ${d.period.year}`;

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <SectionTitle title="Pay" right={<NotificationBell group="(worker)" />} />

      {!d.setup.ready ? (
        <Page>
          <Empty icon="fees">
            Pay is not set up yet — {d.setup.gradeCount} grades, {d.setup.onPay} of {d.setup.rosterSize} people on
            the payroll. It is set up on the school&rsquo;s website.
          </Empty>
        </Page>
      ) : (
        <>
          <Page>
            <PageHeader title={label} icon="fees" />
            <View style={{ paddingHorizontal: 12, paddingBottom: 10, gap: 6 }}>
              <View style={{ flexDirection: 'row' }}>
                <Pill tone={d.run ? 'green' : 'amber'}>{d.run ? d.run.status : 'Not run yet'}</Pill>
              </View>
              <Text style={{ fontFamily: font.sans, fontSize: 11.5, color: tokens.color.sub }}>
                {d.cost.estimated ? 'What it will cost the school' : 'What it costs the school'}
              </Text>
              <Text style={{ fontFamily: font.serif, fontSize: 30, fontWeight: '700', color: tokens.color.ink }}>
                {rupees(d.cost.totalCostMinor)}
              </Text>
              <Text style={{ fontFamily: font.sans, fontSize: 11.5, color: tokens.color.sub }}>
                {d.cost.headcount} on the payroll
              </Text>
            </View>
            <Row first title="To their banks" right={<Text style={{ fontVariant: ['tabular-nums'], fontWeight: '600', color: tokens.color.ink }}>{rupees(d.cost.netMinor)}</Text>} />
            <Row title="School’s own share" right={<Text style={{ fontVariant: ['tabular-nums'], fontWeight: '600', color: tokens.color.ink }}>{rupees(d.cost.employerCostMinor)}</Text>} />
          </Page>

          <Page>
            <PageHeader title="What needs you" icon="results" />
            {d.exceptions.length === 0 ? (
              <Empty icon="results">Nothing is waiting. The month can be worked out.</Empty>
            ) : (
              d.exceptions.map((e, i) => (
                <Row key={e.kind} first={i === 0} title={e.label} sub={`${e.count} ${e.count === 1 ? 'person' : 'people'}`} />
              ))
            )}
            <Text style={{ paddingHorizontal: 12, paddingVertical: 10, fontSize: 11.5, lineHeight: 17, color: tokens.color.sub }}>
              Running the month — working it out, approving, locking — is done on the school&rsquo;s website, where
              the register and the bank file are.
            </Text>
          </Page>
        </>
      )}
    </Screen>
  );
}
