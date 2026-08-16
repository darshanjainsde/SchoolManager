'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import {
  Card,
  DuePill,
  EmptyRow,
  ListRow,
  Pill,
  SectionH,
  apiErrorCode,
  fmtDay,
  rupees,
  type DashboardPayload,
  type IssueCard,
  type MemberCardView,
  type MemberHit,
  type ReturnResult,
  type TitleView,
} from './../ui';

function useDebounced(value: string, ms = 250): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type Mode = 'out' | 'back';

export default function LibraryCounterPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const [mode, setMode] = useState<Mode>('out');

  // ── Give out state ──
  const [memberQ, setMemberQ] = useState('');
  const [bookQ, setBookQ] = useState('');
  const [selMember, setSelMember] = useState<{ kind: 'STUDENT' | 'TEACHER'; id: string } | null>(null);
  const [selTitleId, setSelTitleId] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [lastIssue, setLastIssue] = useState<IssueCard | null>(null);

  // ── Take back state ──
  const [retQ, setRetQ] = useState('');
  const [retMember, setRetMember] = useState<{ kind: 'STUDENT' | 'TEACHER'; id: string } | null>(null);
  const [retResult, setRetResult] = useState<ReturnResult | null>(null);

  const dMemberQ = useDebounced(memberQ);
  const dBookQ = useDebounced(bookQ);
  const dRetQ = useDebounced(retQ);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['library-dashboard'] });
    qc.invalidateQueries({ queryKey: ['library-member'] });
    qc.invalidateQueries({ queryKey: ['library-title'] });
    qc.invalidateQueries({ queryKey: ['library-titles'] });
    qc.invalidateQueries({ queryKey: ['library-fines'] });
  };

  // ── Queries ──
  const memberHits = useQuery({
    queryKey: ['library-members', host, dMemberQ],
    enabled: !!host && dMemberQ.trim().length >= 2 && !selMember,
    queryFn: () => api.get<MemberHit[]>(`/library/members?q=${encodeURIComponent(dMemberQ.trim())}`),
  });
  const memberCard = useQuery({
    queryKey: ['library-member', host, selMember?.kind, selMember?.id],
    enabled: !!host && !!selMember,
    queryFn: () =>
      api.get<MemberCardView>(`/library/members/${selMember!.kind.toLowerCase()}/${selMember!.id}`),
  });
  const titleHits = useQuery({
    queryKey: ['library-titles', host, dBookQ],
    enabled: !!host && dBookQ.trim().length >= 2 && !selTitleId,
    queryFn: () => api.get<TitleView[]>(`/library/titles?q=${encodeURIComponent(dBookQ.trim())}`),
  });
  const titleCard = useQuery({
    queryKey: ['library-title', host, selTitleId],
    enabled: !!host && !!selTitleId,
    queryFn: () => api.get<TitleView>(`/library/titles/${selTitleId}`),
  });
  const dash = useQuery({
    queryKey: ['library-dashboard', host],
    enabled: !!host && mode === 'back',
    queryFn: () => api.get<DashboardPayload>('/library/dashboard'),
  });
  const retTitleHits = useQuery({
    queryKey: ['library-titles', host, dRetQ, 'ret'],
    enabled: !!host && mode === 'back' && dRetQ.trim().length >= 2,
    queryFn: () => api.get<TitleView[]>(`/library/titles?q=${encodeURIComponent(dRetQ.trim())}`),
  });
  const retMemberHits = useQuery({
    queryKey: ['library-members', host, dRetQ, 'ret'],
    enabled: !!host && mode === 'back' && dRetQ.trim().length >= 2 && !retMember,
    queryFn: () => api.get<MemberHit[]>(`/library/members?q=${encodeURIComponent(dRetQ.trim())}`),
  });
  const retMemberCard = useQuery({
    queryKey: ['library-member', host, retMember?.kind, retMember?.id, 'ret'],
    enabled: !!host && !!retMember,
    queryFn: () =>
      api.get<MemberCardView>(`/library/members/${retMember!.kind.toLowerCase()}/${retMember!.id}`),
  });

  // ── Mutations ──
  const issue = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<IssueCard>('/library/issues', body),
    onSuccess: (card) => {
      setWarn(null);
      setLastIssue(card);
      invalidateAll();
      toast.success(`Issued ${card.title} → due ${fmtDay(card.dueOn)}`, {
        action: {
          label: 'Undo',
          onClick: () =>
            voidIssue.mutate(card.id, {
              onSuccess: () => {
                setLastIssue(null);
                toast.success('Issue undone');
              },
            }),
        },
      });
    },
    onError: (e) => {
      const code = apiErrorCode(e);
      if (code === 'LIBRARY_LIMIT' || code === 'LIBRARY_DUPLICATE_TITLE') {
        setWarn((e as Error).message);
      } else {
        toast.error((e as Error).message);
      }
    },
  });
  const voidIssue = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/library/issues/${id}`),
    onSuccess: invalidateAll,
    onError: (e) => toast.error((e as Error).message),
  });
  const returnIssue = useMutation({
    mutationFn: (id: string) => api.post<ReturnResult>(`/library/issues/${id}/return`, {}),
    onSuccess: (res) => {
      setRetResult(res);
      invalidateAll();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const reopen = useMutation({
    mutationFn: (id: string) => api.post<IssueCard>(`/library/issues/${id}/reopen`, {}),
    onSuccess: () => {
      setRetResult(null);
      invalidateAll();
      toast.success('Return undone — the book is out again');
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const markLost = useMutation({
    mutationFn: (id: string) => api.post<ReturnResult>(`/library/issues/${id}/lost`, {}),
    onSuccess: (res) => {
      setRetResult(res);
      invalidateAll();
      toast.success(res.fineRupees ? `Written off — ${rupees(res.fineRupees)} replacement added` : 'Written off');
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const settleFine = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'collect' | 'waive' }) =>
      api.post(`/library/fines/${id}/${action}`, {}),
    onSuccess: (_d, vars) => {
      invalidateAll();
      toast.success(vars.action === 'collect' ? 'Collected' : 'Fine waived');
      setRetResult((r) => (r ? { ...r, fineId: null, fineRupees: 0 } : r));
    },
    onError: (e) => toast.error((e as Error).message),
  });

  function doIssue(override: boolean) {
    if (!selMember || !selTitleId) return;
    issue.mutate({
      titleId: selTitleId,
      ...(selMember.kind === 'STUDENT' ? { studentId: selMember.id } : { teacherId: selMember.id }),
      ...(override ? { override: true } : {}),
    });
  }

  const searchBox = (value: string, set: (v: string) => void, placeholder: string, label: string) => (
    <div className="flex items-center gap-2 rounded-lg border-2 border-[var(--sk-line-2)] bg-[var(--sk-card)] px-3 py-2 shadow-sm focus-within:border-[var(--sk-brand)]">
      <span aria-hidden="true">🔍</span>
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="w-full bg-transparent font-mono text-sm text-[var(--sk-ink)] outline-none placeholder:font-sans placeholder:text-[var(--sk-ink-3)]"
      />
    </div>
  );

  const holdingsList = (card: MemberCardView, withReturn: boolean) => (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--sk-ink-2)]">
        Holding {card.holdings.length} of {card.limit}
        <span className="flex gap-1" aria-hidden="true">
          {Array.from({ length: Math.min(card.limit, 12) }, (_, i) => (
            <i
              key={i}
              className={`h-4 w-3 rounded-[3px] border ${i < card.holdings.length ? 'border-[var(--sk-brand)] bg-[var(--sk-brand)]' : 'border-[var(--sk-line-2)] bg-[var(--sk-bg-2)]'}`}
            />
          ))}
        </span>
        {card.duesRupees > 0 ? <Pill tone="bad">{rupees(card.duesRupees)} fine due</Pill> : null}
      </div>
      {card.holdings.map((h) => (
        <div key={h.id} className="mt-1.5 flex items-center gap-2 text-xs text-[var(--sk-ink-2)]">
          <span className="truncate">{h.title}</span>
          <DuePill dueOn={h.dueOn} today={new Date().toISOString().slice(0, 10)} />
          {withReturn ? (
            <button
              className="rounded-full bg-[var(--sk-brand-tint)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--sk-brand-2)]"
              onClick={() => returnIssue.mutate(h.id)}
            >
              Return
            </button>
          ) : null}
        </div>
      ))}
    </>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-serif text-xl font-semibold" style={{ fontFamily: 'var(--sk-serif)' }}>
          Counter
        </h1>
        <div className="flex rounded-full border border-[var(--sk-line)] bg-[var(--sk-bg-2)] p-0.5">
          {(
            [
              ['out', '📤 Give out'],
              ['back', '📥 Take back'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${mode === m ? 'bg-[var(--sk-card)] text-[var(--sk-brand-2)] shadow-sm' : 'text-[var(--sk-ink-2)]'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'out' ? (
        <div className="grid gap-4 md:grid-cols-2">
          {/* 1 · Who */}
          <div>
            <SectionH>1 · Who</SectionH>
            {searchBox(memberQ, (v) => { setMemberQ(v); setSelMember(null); }, 'Student ID (AAA-00000), name, or a teacher…', 'Find a reader')}
            {!selMember && memberHits.data ? (
              <Card className="mt-2 overflow-hidden">
                {memberHits.data.length ? (
                  memberHits.data.map((m) => (
                    <button
                      key={`${m.kind}-${m.id}`}
                      className="flex w-full items-center gap-2 border-b border-[var(--sk-line)] px-3 py-2 text-left text-sm last:border-b-0 hover:bg-[var(--sk-bg-2)]"
                      onClick={() => { setSelMember({ kind: m.kind, id: m.id }); setWarn(null); setLastIssue(null); }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{m.name}</span>
                        <span className="block text-xs text-[var(--sk-ink-3)]">
                          {m.code ?? 'Teacher'}{m.className ? ` · ${m.className}` : ''}
                        </span>
                      </span>
                      <Pill tone="muted">holding {m.holding}</Pill>
                    </button>
                  ))
                ) : (
                  <EmptyRow>No reader matches “{dMemberQ.trim()}”.</EmptyRow>
                )}
              </Card>
            ) : null}
            {selMember && memberCard.data ? (
              <Card className="relative mt-2 p-3">
                <button
                  aria-label="Clear reader"
                  className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-[var(--sk-bg-2)] text-xs text-[var(--sk-ink-3)]"
                  onClick={() => { setSelMember(null); setMemberQ(''); setWarn(null); setLastIssue(null); }}
                >
                  ✕
                </button>
                <div className="pr-6 text-sm font-bold text-[var(--sk-ink)]">{memberCard.data.borrower.name}</div>
                <div className="text-xs text-[var(--sk-ink-3)]">
                  {memberCard.data.borrower.code ?? 'Teacher'}
                  {memberCard.data.borrower.className ? ` · Class ${memberCard.data.borrower.className}` : ''}
                </div>
                <div className="mt-2">{holdingsList(memberCard.data, false)}</div>
              </Card>
            ) : null}
          </div>

          {/* 2 · Which book */}
          <div>
            <SectionH>2 · Which book</SectionH>
            {searchBox(bookQ, (v) => { setBookQ(v); setSelTitleId(null); }, 'Title, author or book number…', 'Find a book')}
            {!selTitleId && titleHits.data ? (
              <Card className="mt-2 overflow-hidden">
                {titleHits.data.length ? (
                  titleHits.data.map((t) => (
                    <button
                      key={t.id}
                      className="flex w-full items-center gap-2 border-b border-[var(--sk-line)] px-3 py-2 text-left text-sm last:border-b-0 hover:bg-[var(--sk-bg-2)]"
                      onClick={() => { setSelTitleId(t.id); setWarn(null); setLastIssue(null); }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{t.title}</span>
                        <span className="block text-xs text-[var(--sk-ink-3)]">{t.author} · shelf {t.shelf ?? '—'}</span>
                      </span>
                      <Pill tone={t.inCopies ? 'good' : 'bad'}>
                        {t.inCopies} of {t.totalCopies} in
                      </Pill>
                    </button>
                  ))
                ) : (
                  <EmptyRow>No title matches “{dBookQ.trim()}” — add it under New books.</EmptyRow>
                )}
              </Card>
            ) : null}
            {selTitleId && titleCard.data ? (
              <Card className="relative mt-2 p-3">
                <button
                  aria-label="Clear book"
                  className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-[var(--sk-bg-2)] text-xs text-[var(--sk-ink-3)]"
                  onClick={() => { setSelTitleId(null); setBookQ(''); setWarn(null); setLastIssue(null); }}
                >
                  ✕
                </button>
                <div className="pr-6 text-sm font-bold text-[var(--sk-ink)]" style={{ fontFamily: 'var(--sk-serif)' }}>
                  {titleCard.data.title}
                </div>
                <div className="text-xs text-[var(--sk-ink-3)]">
                  {titleCard.data.author} · {titleCard.data.inCopies} of {titleCard.data.totalCopies} in · shelf{' '}
                  {titleCard.data.shelf ?? '—'}
                  {titleCard.data.lostCopies ? ` · ${titleCard.data.lostCopies} lost` : ''}
                </div>
                <div className="mt-2">
                  {titleCard.data.inCopies ? (
                    <Pill tone="good">Available</Pill>
                  ) : (
                    <>
                      <Pill tone="bad">All copies out</Pill>{' '}
                      {titleCard.data.earliestBack ? (
                        <span className="text-xs text-[var(--sk-ink-3)]">
                          earliest back {fmtDay(titleCard.data.earliestBack)}
                        </span>
                      ) : null}
                    </>
                  )}
                </div>

                {warn ? (
                  <div className="mt-2 rounded-lg border border-[var(--sk-amber)] bg-[var(--sk-amber-tint)] p-2.5 text-xs text-[var(--sk-amber-ink)]">
                    ⚠️ {warn}
                    <div className="mt-1.5">
                      <button
                        className="rounded-lg bg-[var(--sk-amber)] px-3 py-1.5 text-xs font-bold text-white"
                        onClick={() => doIssue(true)}
                        disabled={issue.isPending}
                      >
                        Issue anyway
                      </button>
                    </div>
                  </div>
                ) : selMember && titleCard.data.inCopies ? (
                  <button
                    className="mt-2.5 w-full rounded-lg bg-[var(--sk-brand)] py-2 text-sm font-bold text-white disabled:opacity-50"
                    onClick={() => doIssue(false)}
                    disabled={issue.isPending}
                  >
                    {issue.isPending ? 'Issuing…' : 'Issue'}
                  </button>
                ) : !selMember ? (
                  <p className="mt-2 text-xs text-[var(--sk-ink-3)]">Pick a reader on the left to issue.</p>
                ) : null}
              </Card>
            ) : null}

            {lastIssue ? (
              <div
                className="mt-3 inline-flex items-center gap-2 rounded-lg border-2 border-dashed border-[var(--sk-brand-2)] bg-[var(--sk-brand-tint)] px-3 py-1.5 font-mono text-xs font-bold text-[var(--sk-brand-2)]"
                data-testid="issue-stamp"
              >
                📅 ISSUED · {lastIssue.accessionNo} · DUE {fmtDay(lastIssue.dueOn).toUpperCase()}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Find */}
          <div>
            <SectionH>Find the reader or the book</SectionH>
            {searchBox(retQ, (v) => { setRetQ(v); setRetMember(null); }, 'Student ID, name, title or book number…', 'Find a loan')}
            {!retMember && retMemberHits.data?.length ? (
              <Card className="mt-2 overflow-hidden">
                {retMemberHits.data.filter((m) => m.holding > 0).map((m) => (
                  <button
                    key={`${m.kind}-${m.id}`}
                    className="flex w-full items-center gap-2 border-b border-[var(--sk-line)] px-3 py-2 text-left text-sm last:border-b-0 hover:bg-[var(--sk-bg-2)]"
                    onClick={() => setRetMember({ kind: m.kind, id: m.id })}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{m.name}</span>
                      <span className="block text-xs text-[var(--sk-ink-3)]">
                        {m.code ?? 'Teacher'}{m.className ? ` · ${m.className}` : ''}
                      </span>
                    </span>
                    <Pill tone="brand">holding {m.holding}</Pill>
                  </button>
                ))}
              </Card>
            ) : null}
            {retMember && retMemberCard.data ? (
              <Card className="relative mt-2 p-3">
                <button
                  aria-label="Clear reader"
                  className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-[var(--sk-bg-2)] text-xs text-[var(--sk-ink-3)]"
                  onClick={() => { setRetMember(null); setRetQ(''); }}
                >
                  ✕
                </button>
                <div className="pr-6 text-sm font-bold">{retMemberCard.data.borrower.name}</div>
                <div className="mt-2">{holdingsList(retMemberCard.data, true)}</div>
              </Card>
            ) : null}
            {retTitleHits.data?.some((t) => t.copies.some((c) => c.status === 'OUT')) ? (
              <Card className="mt-2 overflow-hidden">
                {retTitleHits.data.flatMap((t) =>
                  t.copies
                    .filter((c) => c.status === 'OUT')
                    .map((c) => (
                      <ListRow
                        key={c.id}
                        primary={<>{t.title} <span className="font-normal text-[var(--sk-ink-3)]">· {c.accessionNo}</span></>}
                        secondary={`${c.borrower?.name ?? ''}${c.borrower?.code ? ` · ${c.borrower.code}` : ''}`}
                      >
                        {c.dueOn ? <DuePill dueOn={c.dueOn} today={new Date().toISOString().slice(0, 10)} /> : null}
                        <button
                          className="rounded-full bg-[var(--sk-brand-tint)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--sk-brand-2)]"
                          onClick={() => c.issueId && returnIssue.mutate(c.issueId)}
                        >
                          Return
                        </button>
                      </ListRow>
                    )),
                )}
              </Card>
            ) : null}

            {retResult ? (
              <Card className="relative mt-3 p-3" data-testid="return-card">
                <span
                  className={`absolute right-3 top-2.5 rotate-[-8deg] rounded-md border-[3px] border-double px-2.5 py-0.5 font-mono text-xs font-extrabold tracking-[0.14em] ${
                    retResult.issue.wasLost
                      ? 'border-[var(--sk-bad)] text-[var(--sk-bad)]'
                      : 'border-[var(--sk-good)] text-[var(--sk-good)]'
                  }`}
                >
                  {retResult.issue.wasLost ? 'LOST' : 'RETURNED'}
                </span>
                <div className="pr-24 text-sm font-bold" style={{ fontFamily: 'var(--sk-serif)' }}>
                  {retResult.issue.title}
                </div>
                <div className="text-xs text-[var(--sk-ink-3)]">
                  {retResult.issue.accessionNo} · {retResult.issue.borrower.name}
                </div>
                {retResult.fineId && retResult.fineRupees > 0 ? (
                  <>
                    <div className="mt-2 flex items-center justify-between rounded-lg border border-[var(--sk-bad)] bg-[var(--sk-bad-tint)] px-3 py-2 text-xs font-semibold text-[var(--sk-bad)]">
                      <span>{retResult.issue.wasLost ? 'Lost — replacement' : 'Late fine'}</span>
                      <b className="tabular-nums">{rupees(retResult.fineRupees)}</b>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button
                        className="rounded-lg bg-[var(--sk-good)] px-3 py-1.5 text-xs font-bold text-white"
                        onClick={() => settleFine.mutate({ id: retResult.fineId!, action: 'collect' })}
                      >
                        Collected {rupees(retResult.fineRupees)}
                      </button>
                      <button
                        className="rounded-lg border border-[var(--sk-line)] px-3 py-1.5 text-xs font-bold text-[var(--sk-ink-2)]"
                        onClick={() => settleFine.mutate({ id: retResult.fineId!, action: 'waive' })}
                      >
                        Waive
                      </button>
                      <button
                        className="rounded-lg border border-[var(--sk-line)] px-3 py-1.5 text-xs font-bold text-[var(--sk-ink-2)]"
                        onClick={() => { setRetResult(null); toast.success('Kept on the fines list'); }}
                      >
                        Collect later
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="mt-2"><Pill tone="good">✓ {retResult.issue.wasLost ? 'written off' : 'on time — no fine'}</Pill></div>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {!retResult.issue.wasLost ? (
                    <>
                      <button
                        className="rounded-lg border border-[var(--sk-line)] px-3 py-1.5 text-xs text-[var(--sk-ink-2)]"
                        onClick={() => reopen.mutate(retResult.issue.id)}
                      >
                        Undo return
                      </button>
                      <button
                        className="rounded-lg border border-[var(--sk-line)] px-3 py-1.5 text-xs text-[var(--sk-ink-2)]"
                        onClick={() => markLost.mutate(retResult.issue.id)}
                      >
                        This copy is actually lost…
                      </button>
                    </>
                  ) : null}
                </div>
              </Card>
            ) : null}
          </div>

          {/* Out right now */}
          <div>
            <SectionH>Out right now{dash.data ? ` · ${dash.data.counts.outNow}` : ''}</SectionH>
            <Card className="overflow-hidden">
              {dash.data?.outNow.length ? (
                dash.data.outNow.slice(0, 10).map((i) => (
                  <ListRow
                    key={i.id}
                    primary={<>{i.title} <span className="font-normal text-[var(--sk-ink-3)]">· {i.accessionNo}</span></>}
                    secondary={`${i.borrower.name}${i.borrower.code ? ` · ${i.borrower.code}` : ''}${i.borrower.className ? ` · ${i.borrower.className}` : ''}`}
                  >
                    <DuePill dueOn={i.dueOn} today={dash.data.today} />
                    <button
                      className="rounded-full bg-[var(--sk-brand-tint)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--sk-brand-2)]"
                      onClick={() => returnIssue.mutate(i.id)}
                    >
                      Return
                    </button>
                  </ListRow>
                ))
              ) : (
                <EmptyRow>Nothing is out — the shelf is full.</EmptyRow>
              )}
              {dash.data && dash.data.counts.outNow > 10 ? (
                <EmptyRow>+ {dash.data.counts.outNow - 10} more — use search</EmptyRow>
              ) : null}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
