import { useState } from 'react';
import { Text, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { Empty, ErrorState, Page, PageHeader, Pill, Screen, SectionTitle } from '@/components/ui';
import { Button, Row } from '@/components/desk';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

interface LeaveRow {
  id: string;
  teacherName: string;
  personKind?: 'TEACHER' | 'STAFF';
  type: string;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reason: string | null;
}

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const span = (r: LeaveRow) =>
  r.halfDay ? `${day(r.startDate)} · half day`
    : r.startDate.slice(0, 10) === r.endDate.slice(0, 10) ? day(r.startDate)
      : `${day(r.startDate)} – ${day(r.endDate)}`;

/**
 * LEAVE, WAITING ON SOMEBODY.
 *
 * The one part of the accounts desk that genuinely belongs on a phone: a
 * decision, made in a corridor, that somebody is standing around waiting for.
 * Approving here is what stops the pay run being blocked on a person who is
 * not at their desk — pending leave is deliberately left out of the month, so
 * an undecided application quietly delays payroll.
 */
export default function LeaveDesk() {
  const tokens = useTokens();
  const q = useQuery<LeaveRow[]>('/manage/leave?status=PENDING');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404)) {
    return (
      <Screen>
        <SectionTitle title="Leave" />
        <Page><Empty icon="take">You do not have the right to decide leave.</Empty></Page>
      </Screen>
    );
  }
  if (q.error) return <Screen><SectionTitle title="Leave" /><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  if (!q.data) return <Screen><SectionTitle title="Leave" /><Page><LoadingRows label="leave waiting" /></Page></Screen>;

  async function decide(id: string, what: 'approve' | 'reject') {
    setBusy(id); setError(null);
    try {
      await api.request(`/manage/leave/${id}/${what}`, { method: 'POST', body: {} });
      q.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(null);
    }
  }

  const rows = q.data;

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <SectionTitle title="Leave" />
      <Page>
        <PageHeader title={rows.length === 0 ? 'Nothing waiting' : `${rows.length} waiting on you`} icon="take" />
        {rows.length === 0 ? (
          <Empty icon="take">
            No leave is waiting. Anything still undecided is left out of the month&apos;s pay, so this being
            empty is what keeps a pay run unblocked.
          </Empty>
        ) : (
          rows.map((r, i) => (
            <View key={r.id}>
              <Row
                first={i === 0}
                title={r.teacherName}
                sub={`${r.type} · ${span(r)}${r.reason ? ` · ${r.reason}` : ''}`}
                right={<Pill tone="amber">Pending</Pill>}
              />
              <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 10 }}>
                <Button label="Approve" small onPress={() => decide(r.id, 'approve')} disabled={busy === r.id} testID={`approve-${r.id}`} />
                <Button label="Reject" variant="ghost" small onPress={() => decide(r.id, 'reject')} disabled={busy === r.id} testID={`reject-${r.id}`} />
              </View>
            </View>
          ))
        )}
        {error ? (
          <Text style={{ paddingHorizontal: 12, paddingBottom: 10, fontFamily: font.sans, fontSize: 12, color: tokens.color.red }}>{error}</Text>
        ) : null}
      </Page>
    </Screen>
  );
}
