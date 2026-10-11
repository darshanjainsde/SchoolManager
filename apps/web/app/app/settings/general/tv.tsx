'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Power, RefreshCw } from 'lucide-react';
import type { TvStatus } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { SettingsActions, SettingsCard, SettingsSection } from '../section';

/**
 * The reception screen. One URL any television's browser can open; the key in
 * it is the whole gate. "New link" rotates the key, which is also the kill
 * switch for a link that leaked.
 */
export function TvSection() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);

  const status = useQuery({
    queryKey: ['tv-status', host],
    enabled: !!host,
    queryFn: () => api.get<TvStatus>('/manage/tv'),
  });
  // POST: these change state (they were GETs until the settings audit).
  const act = useMutation({
    mutationFn: (path: 'rotate' | 'disable') => api.post<TvStatus>(`/manage/tv/${path}`, {}),
    onSuccess: (out, path) => {
      qc.setQueryData(['tv-status', host], out);
      toast.success(path === 'disable' ? 'TV switched off. Old links no longer work.' : 'Fresh TV link ready. Open it on the screen.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'That did not save.'),
  });

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy. Select the link and copy it by hand.');
    }
  }

  const s = status.data;
  return (
    <SettingsSection
      title="Reception TV"
      hint="A rolling display for a TV in your lobby or staff room: today's notices, events, birthdays and your gallery."
      testId="tv-section"
      aside={s ? <span className="sk-pill" data-tone={s.enabled ? 'good' : 'neutral'}>{s.enabled ? 'On' : 'Off'}</span> : null}
    >
      <SettingsCard>
        {status.isLoading ? <p className="sk-state">Checking…</p> : null}
        {status.error ? <p className="sk-state err">{(status.error as Error).message}</p> : null}
        {s && !s.enabled ? (
          <div className="sk-setline">
            <span className="txt">Open the link in the TV&rsquo;s browser and leave it. It updates itself.</span>
            <button type="button" className="sk-btn" data-variant="primary" disabled={act.isPending} onClick={() => act.mutate('rotate')}>
              {act.isPending ? 'Making the link…' : 'Turn the TV on'}
            </button>
          </div>
        ) : null}
        {s?.enabled && s.url ? (
          <>
            <div className="sk-setline">
              <code className="sk-setmono txt" data-testid="tv-url">{s.url}</code>
            </div>
            <SettingsActions>
              <button type="button" className="sk-btn" data-tone="bad" disabled={act.isPending} onClick={() => act.mutate('disable')}>
                <Power size={14} aria-hidden="true" /> Turn off
              </button>
              <button type="button" className="sk-btn" disabled={act.isPending} onClick={() => act.mutate('rotate')}>
                <RefreshCw size={14} aria-hidden="true" /> New link (old one stops)
              </button>
              <button type="button" className="sk-btn" data-variant="primary" onClick={() => copy(s.url!)}>
                <Copy size={14} aria-hidden="true" /> {copied ? 'Copied' : 'Copy link'}
              </button>
            </SettingsActions>
          </>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
