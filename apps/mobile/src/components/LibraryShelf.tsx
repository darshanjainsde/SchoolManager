import { Text, View } from 'react-native';
import { useQuery } from '@/lib/query';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/portal';
import { Empty, ErrorState, Figure, Page, PageHeader, Pill, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/** `GET /me/library` — the reader's own shelf, student or teacher. */
export interface LibraryMe {
  kind: 'STUDENT' | 'TEACHER';
  limit: number;
  loanDays: number;
  finesEnabled: boolean;
  holdings: {
    issueId: string;
    title: string;
    author: string | null;
    accessionNo: string;
    issuedOn: string;
    dueOn: string;
    /** Negative once late. */
    daysLeft: number;
    accruedFineRupees: number;
  }[];
  history: { issueId: string; title: string; author: string | null; returnedOn: string; wasLost: boolean }[];
  fines: { id: string; title: string; reason: string; amountRupees: number }[];
  finesDueRupees: number;
  /** The school's "today", YYYY-MM-DD. */
  today: string;
  /** The school's rules, so the shelf can state them rather than let a fine teach them. */
  rules: { finePerDayRupees: number; graceDays: number; lostFeeRupees: number };
}

/** Fines are whole rupees on this endpoint (not paise) — see LibraryMeService. */
const fine = (r: number) => `₹${r.toLocaleString('en-IN')}`;

function dueWord(h: LibraryMe['holdings'][number]): { text: string; tone: 'red' | 'amber' | 'neutral' } {
  if (h.daysLeft < 0) return { text: `${-h.daysLeft} day${h.daysLeft === -1 ? '' : 's'} late`, tone: 'red' };
  if (h.daysLeft === 0) return { text: 'Due today', tone: 'amber' };
  if (h.daysLeft <= 3) return { text: `${h.daysLeft} day${h.daysLeft === 1 ? '' : 's'}`, tone: 'amber' };
  return { text: `${h.daysLeft} days`, tone: 'neutral' };
}

/**
 * MY SHELF — the same screen for a child and for a teacher, from the same
 * endpoint. Two figures (next due, fine), then one spine per book in the
 * accent: the object the family shelf already draws for a child. Due-soon
 * is the only thing in amber; late is the only thing in red. The counter
 * stays on the web — this is the reader's side of it.
 */
export function LibraryShelf() {
  const tokens = useTokens();
  const q = useQuery<LibraryMe>('/me/library');
  const d = q.data;

  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404) && !d) {
    return (
      <Screen>
        <SectionTitle title="Library" />
        <Page><Empty icon="library">The library isn’t switched on for your school yet.</Empty></Page>
      </Screen>
    );
  }

  const soonest = d?.holdings[0] ?? null; // holdings arrive due-first
  const free = d ? Math.max(0, d.limit - d.holdings.length) : 0;

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <SectionTitle title="Library" />
      {q.loading && <LoadingRows label="Fetching your books…" rows={3} />}
      {q.error && !d && <ErrorState error={q.error} onRetry={q.reload} />}
      {d && (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Figure
              testID="library-next-due"
              label="Next due"
              value={soonest ? (soonest.daysLeft < 0 ? 'Late' : soonest.daysLeft === 0 ? 'Today' : `${soonest.daysLeft} day${soonest.daysLeft === 1 ? '' : 's'}`) : '—'}
              hint={soonest ? formatDate(soonest.dueOn) : 'nothing out'}
              tone={soonest ? (soonest.daysLeft < 0 ? 'bad' : soonest.daysLeft <= 3 ? 'warn' : undefined) : undefined}
            />
            {d.finesEnabled ? (
              <Figure testID="library-fine" label="Fine" value={fine(d.finesDueRupees)} hint={d.finesDueRupees > 0 ? 'pay at the counter' : `nothing owed · ${fine(d.rules.finePerDayRupees)} a day late`} tone={d.finesDueRupees > 0 ? 'bad' : undefined} />
            ) : (
              <Figure label="Can borrow" value={String(free)} hint={`of ${d.limit} · ${d.loanDays} days each`} />
            )}
          </View>

          <Page>
            <PageHeader title="On my shelf" actionLabel={d.holdings.length ? `${d.holdings.length} of ${d.limit}` : undefined} />
            {d.holdings.length === 0 ? (
              <Empty icon="library">{`Nothing out right now. You can take ${d.limit} book${d.limit === 1 ? '' : 's'} for ${d.loanDays} days each — ask at the counter.`}</Empty>
            ) : (
              d.holdings.map((h, i) => {
                const w = dueWord(h);
                return (
                  <View key={h.issueId} testID={`holding-${h.issueId}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: tokens.color.line }}>
                    <Spine tone={i % 3} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontFamily: font.serif, fontSize: 14, fontWeight: '600', color: tokens.color.ink }}>{h.title}</Text>
                      <Text numberOfLines={1} style={{ fontSize: 11, color: tokens.color.sub, marginTop: 1 }}>
                        {h.author ? `${h.author} · ` : ''}due {formatDate(h.dueOn)}{h.accruedFineRupees > 0 ? ` · ${fine(h.accruedFineRupees)} so far` : ''}
                      </Text>
                    </View>
                    <Pill tone={w.tone}>{w.text}</Pill>
                  </View>
                );
              })
            )}
          </Page>

          {d.fines.length > 0 && (
            <Page>
              <PageHeader title="Fines" />
              {d.fines.map((f, i) => (
                <View key={f.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: tokens.color.line }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: tokens.color.ink }} numberOfLines={1}>{f.title}</Text>
                    <Text style={{ fontSize: 11, color: tokens.color.sub }}>{f.reason}</Text>
                  </View>
                  <Text style={{ fontFamily: font.mono, fontSize: 13, fontWeight: '600', color: tokens.color.red }}>{fine(f.amountRupees)}</Text>
                </View>
              ))}
            </Page>
          )}

          {/* The rules in words, so a fine is never how a family learns them. */}
          <Page testID="library-rules">
            <PageHeader title="How the library works" />
            <Text style={{ paddingHorizontal: 12, paddingVertical: 10, fontSize: 12.5, lineHeight: 19, color: tokens.color.ink2 }}>
              {`Borrow up to ${d.limit} book${d.limit === 1 ? '' : 's'} at a time, for ${d.loanDays} days each.`}
              {d.finesEnabled
                ? ` A late book costs ${fine(d.rules.finePerDayRupees)} a day${d.rules.graceDays > 0 ? ` after ${d.rules.graceDays === 1 ? 'one day' : `${d.rules.graceDays} days`} of grace` : ''}; a lost book is ${fine(d.rules.lostFeeRupees)}. Fines are paid at the counter, never here.`
                : ' No fines apply to you.'}
            </Text>
          </Page>

          {d.history.length > 0 && (
            <Page>
              <PageHeader title="Returned" />
              {d.history.slice(0, 20).map((h, i) => (
                <View key={h.issueId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: tokens.color.line, opacity: 0.7 }}>
                  <Spine tone={i % 3} faint />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontFamily: font.serif, fontSize: 13.5, color: tokens.color.ink }}>{h.title}</Text>
                    <Text style={{ fontSize: 10.5, color: tokens.color.sub }}>{h.wasLost ? 'Marked lost' : `Returned ${formatDate(h.returnedOn)}`}</Text>
                  </View>
                </View>
              ))}
            </Page>
          )}
        </>
      )}
    </Screen>
  );
}

/** A book's spine — the accent, deep green or amber, so a shelf reads as a shelf. */
function Spine({ tone, faint }: { tone: number; faint?: boolean }) {
  const tokens = useTokens();
  const color = tone === 0 ? tokens.color.indigo : tone === 1 ? tokens.color.green : tokens.color.amber;
  return (
    <View style={{ width: 26, height: 38, borderTopLeftRadius: 3, borderBottomLeftRadius: 3, borderTopRightRadius: 6, borderBottomRightRadius: 6, backgroundColor: color, opacity: faint ? 0.45 : 1, borderLeftWidth: 3, borderLeftColor: `${tokens.color.ink}33` }} />
  );
}
