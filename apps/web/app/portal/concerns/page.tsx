'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MessageSquarePlus } from 'lucide-react';
import {
  CONCERN_CATEGORY_LABEL, CONCERN_STATUS_LABEL, CONCERN_STATUS_TONE,
  type ConcernAudience, type ConcernCategory, type ConcernDetail, type ConcernRow,
} from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { useHydrated } from '@/lib/use-hydrated';
import { Cell, Overlay, Row, RowList, RowTitle } from '@/components/ui/kit';
import { ConcernThread } from '@/components/concerns/concern-thread';
import { CATEGORY_OPTIONS, ago } from '@/lib/concerns';

/**
 * THE FAMILY'S COMPLAINT BOX.
 *
 * The button says "Raise a concern", not "Complain": a parent asking for a
 * water cooler is not complaining and will not press a button that says they
 * are. Who sees it is the family's own choice, shown by NAME — and when the
 * class has no class teacher that choice is simply not offered, rather than
 * quietly sending it somewhere else.
 */
/** `/me/profile` — the shape the portal already serves, plus the class teacher it now carries. */
interface Me { className: string | null; classTeacherName?: string | null }

export default function PortalConcernsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const hydrated = useHydrated();
  const [writing, setWriting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ audience: ConcernAudience; category: ConcernCategory; title: string; body: string }>({
    audience: 'OFFICE', category: 'OTHER', title: '', body: '',
  });

  // Deliberately the portal's ONE profile key: My profile reads `/me/profile`
  // under the same key, so a family that opens both screens fetches it once
  // instead of twice. A private key here was a second identical round trip.
  const me = useQuery({ queryKey: ['portal-profile'], enabled: !!host, queryFn: () => api.get<Me>('/me/profile') });
  const list = useQuery({ queryKey: ['my-concerns', host], enabled: !!host, queryFn: () => api.get<ConcernRow[]>('/me/concerns') });
  const detail = useQuery({ queryKey: ['my-concern', host, openId], enabled: !!host && !!openId, queryFn: () => api.get<ConcernDetail>(`/me/concerns/${openId}`) });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['my-concerns'] });
    void qc.invalidateQueries({ queryKey: ['my-concern', host, openId] });
  };
  const raise = useMutation({
    mutationFn: () => api.post<ConcernRow>('/me/concerns', form),
    onSuccess: () => {
      refresh(); setWriting(false); setForm({ audience: 'OFFICE', category: 'OTHER', title: '', body: '' });
      toast.success('Raised. The school will see it and write back here.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const comment = useMutation({
    mutationFn: (body: string) => api.post<ConcernDetail>(`/me/concerns/${openId}/comment`, { body }),
    onSuccess: () => { refresh(); toast.success('Sent.'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reopen = useMutation({
    mutationFn: (body: string) => api.post<ConcernDetail>(`/me/concerns/${openId}/reopen`, { body }),
    onSuccess: () => { refresh(); toast.success('Reopened — the school has been told.'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = list.data ?? [];
  const classTeacher = me.data?.classTeacherName ?? null;

  return (
    <div className="flex flex-col gap-4">
      <header className="sk-pagehead">
        <div>
          <h1>Complaint Box</h1>
          <p>
            Tell the school something that needs looking at. You choose who sees it, and you can follow what happens here.
            {classTeacher ? ` Your class teacher is ${classTeacher}.` : ''}
          </p>
        </div>
        {!writing && (
          <button className="sk-btn sk-press" data-variant="primary" onClick={() => setWriting(true)}>
            <MessageSquarePlus size={15} aria-hidden="true" /> Raise a concern
          </button>
        )}
      </header>

      {writing && (
        <section className="sk-card" aria-label="Raise a concern">
          <div className="sk-card-h"><h3>Raise a concern</h3></div>
          <div className="sk-card-b sk-conraise">
            <div>
              <p className="sk-lab">Who should see this</p>
              <div className="sk-conpick" role="group" aria-label="Who should see this">
                <button type="button" aria-pressed={form.audience === 'OFFICE'} onClick={() => setForm({ ...form, audience: 'OFFICE' })}>School office</button>
                {/* Offered only when the class actually HAS a class teacher —
                    a choice that silently goes elsewhere is worse than no choice. */}
                {classTeacher && (
                  <button type="button" aria-pressed={form.audience === 'CLASS_TEACHER'} onClick={() => setForm({ ...form, audience: 'CLASS_TEACHER' })}>
                    Class teacher · {classTeacher}
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="sk-lab" htmlFor="c-category">What is it about</label>
              <select id="c-category" className="sk-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ConcernCategory })}>
                {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div>
              <label className="sk-lab" htmlFor="c-title">In one line</label>
              <input id="c-title" className="sk-input" maxLength={160} placeholder="The bus was late twice this week" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>

            <div>
              <label className="sk-lab" htmlFor="c-body">What happened</label>
              <textarea id="c-body" className="sk-input" rows={4} maxLength={4000} placeholder="Tell us what happened, and when." value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </div>

            <div className="sk-actions">
              <button className="sk-btn sk-press" data-variant="primary" disabled={raise.isPending || form.title.trim().length < 3 || form.body.trim().length < 3} onClick={() => raise.mutate()}>
                {raise.isPending ? 'Sending…' : 'Send it'}
              </button>
              <button className="sk-btn sk-press" onClick={() => setWriting(false)}>Not now</button>
            </div>
          </div>
        </section>
      )}

      <section className="sk-card">
        <div className="sk-card-h"><h3>Your concerns</h3></div>
        <div className="sk-card-b">
          {list.isLoading && <p className="sk-state" style={{ margin: 0 }}>Looking…</p>}
          {list.isError && <p className="sk-state err" style={{ margin: 0 }}>That could not load. Pull to refresh.</p>}
          {list.data && rows.length === 0 && (
            <p className="sk-state" style={{ margin: 0 }}>Nothing raised yet. If something needs the school&rsquo;s attention, raise it here and you will see what happens.</p>
          )}
          {rows.length > 0 && (
            <RowList columns="minmax(0, 1.6fr) auto auto" label="Your concerns">
              {rows.map((r) => (
                <Row key={r.id} onClick={() => setOpenId(r.id)} testId={`my-concern-${r.id}`}>
                  <Cell>
                    <RowTitle
                      title={r.title}
                      sub={`${CONCERN_CATEGORY_LABEL[r.category]} · ${r.audience === 'CLASS_TEACHER' && r.assignedTeacher ? r.assignedTeacher.name : 'school office'}`}
                    />
                  </Cell>
                  <Cell align="end"><span className="sk-pill" data-tone={CONCERN_STATUS_TONE[r.status]}>{CONCERN_STATUS_LABEL[r.status]}</span></Cell>
                  <Cell align="end"><span className="sk-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{ago(r.lastActivityAt)}</span></Cell>
                </Row>
              ))}
            </RowList>
          )}
        </div>
      </section>

      {hydrated && openId && (
        <Overlay title="Your concern" onClose={() => setOpenId(null)}>
          {detail.isLoading && <p className="sk-state">Opening…</p>}
          {detail.isError && <p className="sk-state err">That could not load.</p>}
          {detail.data && (
            <ConcernThread
              concern={detail.data}
              viewer="FAMILY"
              busy={comment.isPending || reopen.isPending}
              onComment={(body) => comment.mutate(body)}
              onReopen={(body) => reopen.mutate(body)}
            />
          )}
        </Overlay>
      )}
    </div>
  );
}
