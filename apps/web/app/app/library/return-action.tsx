'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Pill, rupees, type ReturnResult } from './ui';

/**
 * Take a book back from wherever the librarian is already looking at it.
 *
 * Returning used to mean leaving the list, opening the Counter, searching for
 * the reader again and finding the loan a second time — while the reader stood
 * at the desk holding the book. The action belongs on the row.
 *
 * The awkward part is the fine. A late return raises one, and the moment to
 * settle it is exactly now, with the reader still there — but invalidating the
 * dashboard on success would unmount this row and take the fine with it. So:
 *
 *   no fine  → invalidate immediately, the row leaves, nothing is owed
 *   a fine   → hold the row, show what is owed, and invalidate only once the
 *              librarian has collected, waived, or chosen to leave it open
 *
 * That is the whole reason this component owns state instead of just firing a
 * mutation.
 */
export function ReturnAction({ issueId }: { issueId: string }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [owed, setOwed] = useState<ReturnResult | null>(null);

  const refreshLists = () => {
    qc.invalidateQueries({ queryKey: ['library-dashboard'] });
    qc.invalidateQueries({ queryKey: ['library-member'] });
    qc.invalidateQueries({ queryKey: ['library-title'] });
    qc.invalidateQueries({ queryKey: ['library-titles'] });
  };

  const take = useMutation({
    mutationFn: () => api.post<ReturnResult>(`/library/issues/${issueId}/return`, {}),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['library-fines'] });
      if (res.fineId && res.fineRupees > 0) {
        // Hold this row so the fine can be settled where it was raised.
        setOwed(res);
        return;
      }
      toast.success(`Back on the shelf — ${res.issue.title}`);
      refreshLists();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const settle = useMutation({
    mutationFn: (action: 'collect' | 'waive') =>
      api.post(`/library/fines/${owed!.fineId}/${action}`, {}),
    onSuccess: (_d, action) => {
      toast.success(action === 'collect' ? `Collected ${rupees(owed!.fineRupees)}` : 'Fine waived');
      setOwed(null);
      qc.invalidateQueries({ queryKey: ['library-fines'] });
      refreshLists();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!owed) {
    return (
      <button
        className="sk-btn"
        data-size="sm"
        type="button"
        onClick={() => take.mutate()}
        disabled={take.isPending}
      >
        {take.isPending ? 'Taking back…' : 'Return'}
      </button>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <Pill tone="bad">{rupees(owed.fineRupees)} late</Pill>
      <button
        className="sk-btn"
        data-size="sm"
        data-variant="primary"
        type="button"
        onClick={() => settle.mutate('collect')}
        disabled={settle.isPending}
      >
        Collected
      </button>
      <button
        className="sk-btn"
        data-size="sm"
        type="button"
        onClick={() => settle.mutate('waive')}
        disabled={settle.isPending}
      >
        Waive
      </button>
      <button
        className="sk-btn"
        data-size="sm"
        type="button"
        onClick={() => {
          // Left open on purpose: it stays on the Fines tab, owed by the reader.
          setOwed(null);
          toast.success('Kept on the fines list');
          refreshLists();
        }}
      >
        Later
      </button>
    </span>
  );
}
