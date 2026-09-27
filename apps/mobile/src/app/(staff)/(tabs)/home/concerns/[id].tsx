import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { ConcernDetail, ConcernStatus } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { Screen } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { ConcernThread } from '@/components/ConcernThread';
import { useTokens } from '@/theme/theme-context';

/** One concern a family raised with this class teacher, and everything since. */
export default function StaffConcernThread() {
  const tokens = useTokens();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [concern, setConcern] = useState<ConcernDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setConcern(await api.request<ConcernDetail>(`/teacher/concerns/${id}`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not load.');
    }
  }, [id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'That did not go through.'); }
    finally { setBusy(false); }
  };

  return (
    <Screen onRefresh={() => void load()}>
      {error ? <Text style={{ fontSize: 13, color: tokens.color.red, marginBottom: 10 }}>{error}</Text> : null}
      {!concern ? <LoadingRows label="Loading this concern" rows={4} /> : (
        <ConcernThread
          concern={concern}
          viewer="TEACHER"
          busy={busy}
          onComment={(body, visibleToFamily) => void act(() => api.request(`/teacher/concerns/${id}/comment`, { method: 'POST', body: { body, visibleToFamily } }))}
          onStatus={(status: ConcernStatus) => void act(() => api.request(`/teacher/concerns/${id}/status`, { method: 'POST', body: { status } }))}
          onEscalate={() => void act(() => api.request(`/teacher/concerns/${id}/escalate`, { method: 'POST', body: {} }))}
        />
      )}
    </Screen>
  );
}
