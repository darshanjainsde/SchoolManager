import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { useDeskMe } from '@/lib/use-desk';
import { can, standings, type HouseRow, type PointRow } from '@/lib/sports-desk';
import { formatDate } from '@/lib/portal';
import { Empty, ErrorState, Page, PageHeader, Screen, SectionTitle, Toast } from '@/components/ui';
import { Button, NumberBox, Row, Swatch } from '@/components/desk';
import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/Field';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/**
 * HOUSES — the table as the school reads it (leader first, ties share a
 * place) and the ledger under it: every award with its reason, newest
 * first, because "why is Blue ahead?" is the question a house captain asks
 * within a minute. Award points (HOUSES right) is a sheet with a reason
 * that is required — a point with no reason is what makes a table argued.
 */
export default function Houses() {
  const tokens = useTokens();
  const me = useDeskMe();
  const houses = useQuery<HouseRow[]>('/sports/houses');
  const ledger = useQuery<PointRow[]>('/sports/houses/ledger');
  const table = useMemo(() => standings(houses.data ?? []), [houses.data]);
  const nameOf = useMemo(() => new Map((houses.data ?? []).map((h) => [h.id, h])), [houses.data]);
  const [awarding, setAwarding] = useState<HouseRow | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const may = can(me.data, 'HOUSES');

  return (
    <Screen onRefresh={() => { houses.refresh(); ledger.refresh(); }} refreshing={houses.refreshing}>
      <SectionTitle title="Houses" />
      {houses.loading && <LoadingRows label="Fetching the houses…" rows={3} />}
      {houses.error && !houses.data && <ErrorState error={houses.error} onRetry={houses.reload} />}
      {houses.data && table.length === 0 && <Page><Empty icon="assignments">No houses yet. The office sets them up on the web desk.</Empty></Page>}
      {table.length > 0 && (
        <Page testID="house-table">
          <PageHeader title="Table" icon="assignments" />
          {table.map((h, i) => (
            <Row
              key={h.id}
              first={i === 0}
              testID={`house-${h.id}`}
              title={`${h.place}. ${h.name}`}
              sub={`${h.members} member${h.members === 1 ? '' : 's'}`}
              right={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Swatch color={h.color} />
                  <Text style={{ fontFamily: font.mono, fontWeight: '700', fontSize: 15, color: tokens.color.ink }}>{h.points}</Text>
                  {may && <Button small variant="ghost" testID={`award-${h.id}`} label="Award" onPress={() => setAwarding(h)} />}
                </View>
              }
            />
          ))}
        </Page>
      )}
      {ledger.data && ledger.data.length > 0 && (
        <Page testID="house-ledger">
          <PageHeader title="Recent points" icon="report" />
          {ledger.data.slice(0, 30).map((p, i) => (
            <Row key={p.id} first={i === 0} title={p.reason} sub={`${nameOf.get(p.houseId)?.name ?? 'House'} · ${formatDate(p.createdAt)}`} right={<Text style={{ fontFamily: font.mono, fontWeight: '700', color: p.points < 0 ? tokens.color.red : tokens.color.green }}>{p.points > 0 ? `+${p.points}` : p.points}</Text>} />
          ))}
        </Page>
      )}
      {toast && <Toast kind={toast.kind} message={toast.message} />}
      {awarding && <AwardSheet house={awarding} onClose={() => setAwarding(null)} onSaved={(m) => { setAwarding(null); setToast({ kind: 'success', message: m }); houses.reload(); ledger.reload(); }} />}
    </Screen>
  );
}

function AwardSheet({ house, onClose, onSaved }: { house: HouseRow; onClose: () => void; onSaved: (m: string) => void }) {
  const tokens = useTokens();
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = parseInt(points, 10);
  const ready = Number.isFinite(n) && n !== 0 && reason.trim().length > 0;

  async function save() {
    setBusy(true); setError(null);
    try {
      await api.request(`/sports/houses/${house.id}/points`, { method: 'POST', body: { points: n, reason: reason.trim() } });
      onSaved(`${n > 0 ? '+' : ''}${n} to ${house.name}.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not award the points.');
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={`Points for ${house.name}`} subtitle="A minus takes points away. The reason shows on the ledger." testID="award-sheet"
      footer={<Button testID="award-save" label="Award" onPress={() => void save()} disabled={!ready} busy={busy} />}>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: tokens.color.ink }}>Points</Text>
          <NumberBox width={96} testID="award-points" value={points} onChangeText={(v) => setPoints(v.replace(/[^0-9-]/g, ''))} placeholder="10" />
        </View>
        <TextField label="Reason" testID="award-reason" value={reason} onChangeText={setReason} placeholder="Won the march-past" maxLength={120} />
        {error && <Toast kind="error" message={error} />}
      </View>
    </Sheet>
  );
}
