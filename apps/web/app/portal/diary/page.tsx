'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { DiarySignResult, StudentDiaryEntry, StudentDiaryResult } from '@skoolos/types';
import { Input } from '@/components/ui/input';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayLabel(iso: string): string {
  if (iso === todayIso()) return 'Today';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * The diary at home, on the web (Phase 5·3) — the same pages the app shows,
 * grouped by day with the red margin rule on a remark and a signature line
 * under it.
 *
 * Copy is role-neutral for the same reason the app's is: one STUDENT login
 * serves both the student and whoever at home uses it, so nothing here
 * addresses the reader as a parent.
 */
export default function PortalDiaryPage(): React.JSX.Element {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const key = ['p-diary'];
  const query = useQuery({
    queryKey: key,
    enabled: !!host,
    queryFn: () => api.get<StudentDiaryResult>('/me/diary'),
  });

  const sign = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.post<DiarySignResult>(`/me/diary/${id}/sign`, { signedName: name }),
    onSuccess: () => {
      toast.success('Signed.');
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const entries = query.data?.entries ?? [];
  const days: { date: string; entries: StudentDiaryEntry[] }[] = [];
  for (const entry of entries) {
    const last = days[days.length - 1];
    if (last && last.date === entry.date) last.entries.push(entry);
    else days.push({ date: entry.date, entries: [entry] });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead">
        <h1>Diary</h1>
        <p>
          Everything the teachers wrote this month
          {query.data && query.data.unsignedCount > 0
            ? ` — ${query.data.unsignedCount} still to sign.`
            : '.'}
        </p>
      </header>

      {query.isLoading && <p className="sk-state">Opening the diary…</p>}
      {query.error && <p className="sk-state err">{(query.error as Error).message}</p>}
      {!query.isLoading && !query.error && entries.length === 0 && (
        <div className="sk-card">
          <div className="sk-card-b">
            <p className="sk-state">
              Nothing in the diary this month. Anything a teacher writes turns up here.
            </p>
          </div>
        </div>
      )}

      {days.map((day) => (
        <div className="sk-card" key={day.date}>
          <div className="sk-card-h">
            <h3>{dayLabel(day.date)}</h3>
          </div>
          <div className="sk-card-b">
            {day.entries.map((e) => {
              const red = e.kind === 'REMARK';
              return (
                <div
                  key={e.id}
                  data-testid={`diary-${e.id}`}
                  className="sk-row"
                  style={{
                    alignItems: 'flex-start',
                    borderLeft: `3px solid ${red ? 'var(--sk-bad)' : 'var(--sk-brand-tint)'}`,
                    paddingLeft: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className="nm"
                      style={red ? { color: 'var(--sk-bad)', fontStyle: 'italic' } : undefined}
                    >
                      {e.body}
                    </div>
                    <div className="meta">
                      {e.teacherName}
                      {e.subjectName ? ` · ${e.subjectName}` : ''}
                      {e.personal ? ' · for you' : ''}
                    </div>

                    {red &&
                      (e.signedAt ? (
                        <div
                          className="meta"
                          data-testid={`signed-${e.id}`}
                          style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}
                        >
                          <span className="sk-pill" data-tone="good">
                            Signed
                          </span>
                          by {e.signedName}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2" style={{ marginTop: 10, maxWidth: 380 }}>
                          <p className="sk-state" style={{ padding: 0 }}>
                            A copy has already been emailed home. Sign to tell the teacher it was
                            read.
                          </p>
                          <Input
                            data-testid={`sign-name-${e.id}`}
                            placeholder="Who is signing?"
                            value={drafts[e.id] ?? ''}
                            onChange={(ev) =>
                              setDrafts((d) => ({ ...d, [e.id]: ev.target.value }))
                            }
                          />
                          <button
                            type="button"
                            className="sk-btn"
                            data-variant="primary"
                            data-testid={`sign-${e.id}`}
                            disabled={!(drafts[e.id] ?? '').trim() || sign.isPending}
                            onClick={() =>
                              sign.mutate({ id: e.id, name: (drafts[e.id] ?? '').trim() })
                            }
                          >
                            {sign.isPending ? 'Signing…' : 'Sign this remark'}
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
