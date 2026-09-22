import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { type TitleView } from '@/lib/library-desk';
import { formatDate } from '@/lib/portal';
import { Empty, Page, Pill, Screen, SectionTitle, Toast } from '@/components/ui';
import { Button, Row, SearchBox } from '@/components/desk';
import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/Field';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';

/**
 * BOOKS — the catalogue, searched. A title opens to its copies, each with
 * its status: a copy that is OUT says who has it and offers Return right
 * there, because the child at the counter often brings the book and not
 * their name. Adding a title and a copy is here too; bulk import stays on
 * the web.
 */
export default function Books() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<TitleView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [tick, setTick] = useState(0);
  // The open sheet follows the latest search result for its title, so a
  // Return inside it redraws the copy as IN without closing it.
  const open = openId ? (hits ?? []).find((t) => t.id === openId) ?? null : null;

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); return; }
    let cancelled = false;
    setLoading(true);
    const h = setTimeout(() => {
      api.request<TitleView[]>(`/library/titles?q=${encodeURIComponent(term)}`)
        .then((r) => { if (!cancelled) { setHits(r); setError(null); } })
        .catch((e: unknown) => { if (!cancelled) setError(e instanceof ApiError ? e.message : 'Search failed.'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(h); };
  }, [q, tick]);

  async function returnCopy(issueId: string, title: string) {
    try {
      await api.request(`/library/issues/${issueId}/return`, { method: 'POST', body: {} });
      setToast({ kind: 'success', message: `${title} is back.` });
      setTick((n) => n + 1);
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof ApiError ? e.message : 'Could not take it back.' });
    }
  }
  async function addCopy(t: TitleView) {
    try {
      await api.request(`/library/titles/${t.id}/copies`, { method: 'POST', body: {} });
      setToast({ kind: 'success', message: `Another copy of ${t.title} added.` });
      setTick((n) => n + 1);
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof ApiError ? e.message : 'Could not add a copy.' });
    }
  }

  return (
    <Screen>
      <SectionTitle title="Books" actionLabel="Add title" onAction={() => setAdding(true)} />
      <SearchBox testID="books-search" value={q} onChangeText={setQ} placeholder="Title, author or accession number" />
      {loading && !hits && <LoadingRows label="Searching the shelves…" rows={3} />}
      {error && <Toast kind="error" message={error} />}
      {!hits && !loading && <Page><Empty icon="notes">Type two letters of a title or an author. An accession number finds its copy.</Empty></Page>}
      {hits && hits.length === 0 && <Page><Empty icon="notes">Nothing on the shelves by that name. “Add title” puts it in.</Empty></Page>}
      {hits && hits.length > 0 && (
        <Page testID="books-hits">
          {hits.map((t, i) => (
            <Row key={t.id} first={i === 0} testID={`book-${t.id}`} title={t.title} sub={`${t.author}${t.shelf ? ` · shelf ${t.shelf}` : ''}`} right={<Pill tone={t.inCopies ? 'green' : t.totalCopies ? 'red' : 'neutral'}>{`${t.inCopies} of ${t.totalCopies} in`}</Pill>} onPress={() => setOpenId(t.id)} />
          ))}
        </Page>
      )}
      {toast && <Toast kind={toast.kind} message={toast.message} />}

      <Sheet open={!!open} onClose={() => setOpenId(null)} title={open?.title ?? ''} subtitle={open ? `${open.author}${open.shelf ? ` · shelf ${open.shelf}` : ''}` : undefined} testID="book-sheet"
        footer={open ? <Button variant="ghost" testID="book-add-copy" label="Add a copy" onPress={() => Alert.alert('Add a copy?', `A new accession number for ${open.title}.`, [{ text: 'No', style: 'cancel' }, { text: 'Add', onPress: () => void addCopy(open) }])} /> : undefined}>
        {open && open.copies.length === 0 && <Empty>No copies yet.</Empty>}
        {open?.copies.map((c, i) => (
          <Row key={c.id} first={i === 0} mono testID={`copy-${c.id}`} title={c.accessionNo}
            sub={c.status === 'OUT' && c.borrower ? `${c.borrower.name}${c.dueOn ? ` · due ${formatDate(c.dueOn)}` : ''}` : c.status === 'LOST' ? 'marked lost' : 'on the shelf'}
            right={c.status === 'OUT' && c.issueId ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {c.borrower && <Button small variant="ghost" testID={`copy-reader-${c.id}`} label="Reader" onPress={() => { setOpenId(null); router.push(`/(worker)/(tabs)/counter/member/${c.borrower!.kind.toLowerCase()}/${c.borrower!.id}`); }} />}
                <Button small testID={`copy-return-${c.id}`} label="Return" onPress={() => void returnCopy(c.issueId!, open.title)} />
              </View>
            ) : <Pill tone={c.status === 'IN' ? 'green' : c.status === 'LOST' ? 'red' : 'neutral'}>{c.status === 'IN' ? 'In' : c.status === 'LOST' ? 'Lost' : c.status}</Pill>} />
        ))}
      </Sheet>

      {adding && <AddTitleSheet onClose={() => setAdding(false)} onAdded={(m, title) => { setAdding(false); setToast({ kind: 'success', message: m }); setQ(title); }} />}
    </Screen>
  );
}

function AddTitleSheet({ onClose, onAdded }: { onClose: () => void; onAdded: (m: string, title: string) => void }) {
  const tokens = useTokens();
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [shelf, setShelf] = useState('');
  const [copies, setCopies] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = parseInt(copies, 10);
  const ready = title.trim().length > 0 && Number.isFinite(n) && n >= 1 && n <= 50;

  async function save() {
    setBusy(true); setError(null);
    try {
      // The catalogue makes the title with its first copy; every further copy
      // is its own accession number, asked for one at a time like the web does.
      const made = await api.request<{ id: string }>('/library/titles', { method: 'POST', body: { title: title.trim(), author: author.trim() || 'Unknown', ...(shelf.trim() ? { shelf: shelf.trim() } : {}) } });
      for (let i = 1; i < n; i += 1) await api.request(`/library/titles/${made.id}/copies`, { method: 'POST', body: {} });
      onAdded(`${title.trim()} added with ${n} cop${n === 1 ? 'y' : 'ies'}.`, title.trim());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add the title.');
      setBusy(false);
    }
  }
  return (
    <Sheet open onClose={onClose} title="Add a title" subtitle="Copies get accession numbers in order." testID="add-title-sheet"
      footer={<Button testID="add-title-save" label="Add to the catalogue" onPress={() => void save()} disabled={!ready} busy={busy} />}>
      <View style={{ gap: 10 }}>
        <TextField label="Title" testID="add-title" value={title} onChangeText={setTitle} placeholder="Malgudi Days" autoFocus maxLength={200} />
        <TextField label="Author" testID="add-author" value={author} onChangeText={setAuthor} placeholder="R. K. Narayan" maxLength={120} />
        <TextField label="Shelf" testID="add-shelf" value={shelf} onChangeText={setShelf} placeholder="Fiction · B2" maxLength={40} />
        <TextField label="Copies" testID="add-copies" value={copies} onChangeText={(v) => setCopies(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="1" />
        <Text style={{ fontSize: 11.5, color: tokens.color.sub }}>ISBN and a bulk import are on the web catalogue.</Text>
        {error && <Toast kind="error" message={error} />}
      </View>
    </Sheet>
  );
}
