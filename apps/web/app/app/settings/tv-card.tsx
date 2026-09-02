'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, MonitorPlay, RefreshCw, Power } from 'lucide-react';
import type { TvStatus } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';

/**
 * Sckools TV — the reception screen.
 *
 * One URL any television's browser can open; the key in it is the whole
 * gate. "New link" rotates the key, which is also the kill switch for a link
 * that leaked: every screen showing the old URL goes dark on its next reload.
 */
export function TvCard() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);

  const status = useQuery({
    queryKey: ['tv-status', host], enabled: !!host,
    queryFn: () => api.get<TvStatus>('/manage/tv'),
  });

  const act = useMutation({
    mutationFn: (path: 'rotate' | 'disable') => api.get<TvStatus>(`/manage/tv/${path}`),
    onSuccess: (out, path) => {
      qc.setQueryData(['tv-status', host], out);
      toast.success(path === 'disable' ? 'TV switched off — old links are dead.' : 'Fresh TV link ready. Open it on the screen.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'That did not save.'),
  });

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select the link and copy it by hand.');
    }
  }

  const s = status.data;

  return (
    <div className="sk-card">
      <div className="sk-card-h" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <MonitorPlay size={16} style={{ color: 'var(--sk-brand-2)' }} aria-hidden="true" />
        <h3>Reception TV</h3>
      </div>
      <div className="sk-card-b">
        <p className="sk-muted" style={{ margin: 0, fontSize: 13 }}>
          A rolling display for a TV in your lobby or staff room: today&rsquo;s notices and events, birthdays, and your
          gallery — from what you already keep here, on your school&rsquo;s own colours. Open the link in the
          TV&rsquo;s browser and leave it.
        </p>

        {status.isLoading && <p className="sk-state">Checking…</p>}

        {s && !s.enabled && (
          <button className="sk-btn" data-variant="primary" style={{ alignSelf: 'flex-start' }}
            disabled={act.isPending} onClick={() => act.mutate('rotate')}>
            {act.isPending ? 'Making the link…' : 'Turn the TV on'}
          </button>
        )}

        {s?.enabled && s.url && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{ flex: 1, minWidth: 220, fontSize: 12, padding: '8px 10px', background: 'var(--sk-bg-2)', borderRadius: 8, overflowX: 'auto', whiteSpace: 'nowrap' }}>
                {s.url}
              </code>
              <button className="sk-btn" onClick={() => copy(s.url!)}>
                <Copy size={14} aria-hidden="true" /> {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="sk-btn" disabled={act.isPending} onClick={() => act.mutate('rotate')}>
                <RefreshCw size={14} aria-hidden="true" /> New link (old one dies)
              </button>
              <button className="sk-btn" data-icon data-tone="bad" aria-label="Turn the TV off"
                disabled={act.isPending} onClick={() => act.mutate('disable')}>
                <Power size={15} aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
