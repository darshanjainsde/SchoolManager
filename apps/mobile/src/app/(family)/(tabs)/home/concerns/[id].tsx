import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { ConcernDetail } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { ErrorState, Screen } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { ConcernThread } from '@/components/ConcernThread';
import { useTokens } from '@/theme/theme-context';

/** One of the family's own concerns, with everything the school said back. */
export default function FamilyConcernThread() {
  const tokens = useTokens();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [concern, setConcern] = useState<ConcernDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setConcern(await api.request<ConcernDetail>(`/me/concerns/${id}`));
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
      {/* No thread and a failure: the page failed, offer the way back. A
          failure once the thread is up is an action that did not go through,
          said beside the thread rather than in place of it. */}
      {error && concern ? <Text style={{ fontSize: 13, color: tokens.color.red, marginBottom: 10 }}>{error}</Text> : null}
      {!concern && error ? <ErrorState error={error} onRetry={() => void load()} /> : !concern ? <LoadingRows label="Loading this concern" rows={4} /> : (
        <ConcernThread
          concern={concern}
          viewer="FAMILY"
          busy={busy}
          onComment={(body) => void act(() => api.request(`/me/concerns/${id}/comment`, { method: 'POST', body: { body } }))}
          onReopen={(body) => void act(() => api.request(`/me/concerns/${id}/reopen`, { method: 'POST', body: { body } }))}
        />
      )}
    </Screen>
  );
}
