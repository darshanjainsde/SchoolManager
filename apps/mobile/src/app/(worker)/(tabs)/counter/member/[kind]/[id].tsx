import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { borrowerLine, dueWord, rupees, type IssueCard, type MemberCard, type TitleView } from '@/lib/library-desk';
import { formatDate } from '@/lib/portal';
import { Empty, ErrorState, Figure, Page, PageHeader, Pill, Screen, SectionTitle, Toast } from '@/components/ui';
import { Button, Row, SearchBox } from '@/components/desk';
import { Sheet } from '@/components/Sheet';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';

/**
 * ONE READER AT THE COUNTER. Their shelf with a Return on every line, the
 * fine they owe, and the Issue door. Issue is warn-don't-block, the
 * library's rule: at the limit or already holding this title, the server
 * says so with a 409 and the librarian may say "Issue anyway" — the
 * decision stays a person's, the app only carries it.
 */
export default function Member() {
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>();
  const tokens = useTokens();
  const card = useQuery<MemberCard>(kind && id ? `/library/members/${kind}/${id}` : null);
  const dash = useQuery<{ today: string }>('/library/dashboard');
  const today = dash.data?.today ?? new Date().toISOString().slice(0, 10);
  const [issuing, setIssuing] = useState(false);
  const [returning, setReturning] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const b = card.data?.borrower;

  async function doReturn(c: IssueCard) {
    setReturning(c.id);
    try {
      await api.request(`/library/issues/${c.id}/return`, { method: 'POST', body: {} });
      setToast({ kind: 'success', message: `${c.title} is back.` });
      card.reload();
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof ApiError ? e.message : 'Could not take it back.' });
    } finally { setReturning(null); }
  }
  function confirmReturn(c: IssueCard) {
    const w = dueWord(c.dueOn, today);
    Alert.alert('Take this book back?', `${c.title} · ${c.accessionNo}${w.tone === 'red' ? ` · ${w.text}${c.accruedFineRupees ? `, ${rupees(c.accruedFineRupees)} fine` : ''}` : ''}`, [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Return', onPress: () => void doReturn(c) },
    ]);
  }

  return (
    <Screen onRefresh={card.refresh} refreshing={card.refreshing}>
      <SectionTitle title={b?.name ?? 'Reader'} actionLabel={card.data ? 'Issue a book' : undefined} onAction={card.data ? () => setIssuing(true) : undefined} />
      {b && <Text style={{ marginHorizontal: 4, marginTop: -6, fontSize: 11.5, color: tokens.color.sub }}>{borrowerLine(b)}</Text>}
      {card.loading && <LoadingRows label="Opening their shelf…" rows={3} />}
      {card.error && !card.data && <ErrorState error={card.error} onRetry={card.reload} />}
      {card.data && (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Figure testID="member-holding" label="Holding" value={`${card.data.holdings.length} of ${card.data.limit}`} hint={card.data.holdings.length >= card.data.limit ? 'at the limit' : 'can take more'} tone={card.data.holdings.length >= card.data.limit ? 'warn' : undefined} />
            <Figure testID="member-dues" label="Owes" value={rupees(card.data.duesRupees)} hint={card.data.duesRupees ? 'collect at Fines' : 'nothing owed'} tone={card.data.duesRupees ? 'bad' : undefined} />
          </View>
          <Page testID="member-shelf">
            <PageHeader title="On their shelf" icon="library" />
            {card.data.holdings.length === 0 ? <Empty icon="library">Nothing out. Issue a book from the button above.</Empty> : card.data.holdings.map((c, i) => {
              const w = dueWord(c.dueOn, today);
              return (
                <Row key={c.id} first={i === 0} testID={`holding-${c.id}`} title={c.title} sub={`${c.accessionNo} · due ${formatDate(c.dueOn)}${c.accruedFineRupees ? ` · ${rupees(c.accruedFineRupees)} so far` : ''}`}
                  right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Pill tone={w.tone}>{w.text}</Pill><Button small variant="ghost" testID={`return-${c.id}`} label="Return" onPress={() => confirmReturn(c)} busy={returning === c.id} /></View>} />
              );
            })}
          </Page>
        </>
      )}
      {toast && <Toast kind={toast.kind} message={toast.message} />}
      {issuing && card.data && (
        <IssueSheet reader={card.data} onClose={() => setIssuing(false)} onIssued={(m) => { setIssuing(false); setToast({ kind: 'success', message: m }); card.reload(); }} />
      )}
    </Screen>
  );
}

function IssueSheet({ reader, onClose, onIssued }: { reader: MemberCard; onClose: () => void; onIssued: (m: string) => void }) {
  const tokens = useTokens();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<TitleView[] | null>(null);
  const [picked, setPicked] = useState<TitleView | null>(null);
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); return; }
    let cancelled = false;
    const h = setTimeout(() => {
      api.request<TitleView[]>(`/library/titles?q=${encodeURIComponent(term)}`)
        .then((r) => { if (!cancelled) setHits(r); })
        .catch((e: unknown) => { if (!cancelled) setError(e instanceof ApiError ? e.message : 'Search failed.'); });
    }, 250);
    return () => { cancelled = true; clearTimeout(h); };
  }, [q]);

  async function issue(override: boolean) {
    if (!picked) return;
    setBusy(true); setError(null);
    const who = reader.borrower.kind === 'STUDENT' ? { studentId: reader.borrower.id } : { teacherId: reader.borrower.id };
    // A typed accession number picks THAT copy; a title picks any free copy.
    const exact = picked.copies.find((c) => c.accessionNo.toLowerCase() === q.trim().toLowerCase() && c.status === 'IN');
    const what = exact ? { copyId: exact.id } : { titleId: picked.id };
    try {
      const r = await api.request<IssueCard>('/library/issues', { method: 'POST', body: { ...what, ...who, ...(override ? { override: true } : {}) } });
      onIssued(`${r.title} issued · back by ${formatDate(r.dueOn)}.`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && (e.code === 'LIBRARY_LIMIT' || e.code === 'LIBRARY_DUPLICATE_TITLE')) {
        setWarn(e.message.replace(/\s*Send override: true to issue anyway\.?/i, ''));
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not issue that book.');
      }
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={`Issue to ${reader.borrower.name}`} subtitle={`Holding ${reader.holdings.length} of ${reader.limit}`} testID="issue-sheet"
      footer={picked ? (
        warn ? (
          <View style={{ gap: 8 }}>
            <Text testID="issue-warn" style={{ fontSize: 12.5, color: tokens.color.late, fontWeight: '600' }}>{warn}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Button variant="ghost" label="Don't issue" onPress={onClose} /></View>
              <View style={{ flex: 1 }}><Button variant="amber" testID="issue-anyway" label="Issue anyway" onPress={() => void issue(true)} busy={busy} /></View>
            </View>
          </View>
        ) : (
          <Button testID="issue-go" label={`Issue ${picked.title}`} onPress={() => void issue(false)} busy={busy} disabled={picked.inCopies === 0} />
        )
      ) : undefined}>
      <View style={{ gap: 10 }}>
        {picked ? (
          <Row first title={picked.title} sub={`${picked.author}${picked.shelf ? ` · shelf ${picked.shelf}` : ''} · ${picked.inCopies} of ${picked.totalCopies} in`} right={<Button small variant="ghost" label="Change" onPress={() => { setPicked(null); setWarn(null); }} />} />
        ) : (
          <>
            <SearchBox testID="issue-search" value={q} onChangeText={setQ} placeholder="Title, author or accession number" autoFocus />
            {hits && hits.length === 0 && <Empty>No title matches. Add it under Books first.</Empty>}
            {(hits ?? []).map((t, i) => (
              <Row key={t.id} first={i === 0} testID={`title-${t.id}`} title={t.title} sub={`${t.author} · ${t.inCopies} of ${t.totalCopies} in${t.inCopies === 0 && t.earliestBack ? ` · back ${formatDate(t.earliestBack)}` : ''}`} right={<Pill tone={t.inCopies ? 'green' : 'red'}>{t.inCopies ? 'In' : 'Out'}</Pill>} onPress={() => setPicked(t)} />
            ))}
          </>
        )}
        {picked && picked.inCopies === 0 && <Text style={{ fontSize: 12.5, color: tokens.color.red }}>Every copy is out{picked.earliestBack ? ` — earliest back ${formatDate(picked.earliestBack)}` : ''}.</Text>}
        {error && <Toast kind="error" message={error} />}
      </View>
    </Sheet>
  );
}
