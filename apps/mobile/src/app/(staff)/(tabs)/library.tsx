import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { MeLibraryPayload } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { dueChipLabel, dueTone, fmtDay, rupees } from '@/lib/library';
import { Card, Empty, Page, Pill, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/**
 * The teacher's own shelf — the same GET /me/library the web tab reads, so a
 * book taken at the counter shows here with the counter's own due date. The
 * Fines section exists only while the librarian's "fine teachers too" setting
 * is on: `finesEnabled` comes from the server, and when it is off the section
 * is absent entirely rather than an empty room.
 */
export default function StaffLibrary() {
  const tokens = useTokens();
  const [shelf, setShelf] = useState<MeLibraryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notInPlan, setNotInPlan] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      api
        .request<MeLibraryPayload>('/me/library')
        .then((d) => {
          if (!cancelled) setShelf(d);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          if (e instanceof ApiError && e.status === 403) setNotInPlan(true);
          else setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  if (notInPlan) {
    return (
      <Screen>
        <SectionTitle title="Library" />
        <Empty icon="library">The library isn’t part of this school’s plan yet.</Empty>
      </Screen>
    );
  }

  const pillTone = { green: 'green', amber: 'amber', red: 'red' } as const;

  return (
    <Screen>
      <SectionTitle title="Library" />

      {error && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{error}</Text>
        </Card>
      )}
      {shelf === null && !error && <LoadingRows label="Fetching your books…" rows={3} />}

      {shelf !== null && !error && (
        <>
          <SectionTitle title={`Holding now · ${shelf.holdings.length} of ${shelf.limit}`} />
          <Page>
            {shelf.holdings.length === 0 ? (
              <Empty icon="library">Nothing out — visit the library!</Empty>
            ) : (
              shelf.holdings.map((h, i) => (
                <View
                  key={h.issueId}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    gap: 5,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: tokens.color.line,
                  }}
                >
                  <Text style={{ fontFamily: font.serif, fontSize: 15, fontWeight: '600', color: tokens.color.ink }}>
                    {h.title}
                  </Text>
                  <Text style={{ fontSize: 11, color: tokens.color.sub }}>
                    {h.author} · {h.accessionNo} · issued {fmtDay(h.issuedOn)}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    <Pill tone={pillTone[dueTone(h.daysLeft)]}>
                      {dueChipLabel(h.daysLeft, h.dueOn, 0)}
                    </Pill>
                    {shelf.finesEnabled && h.accruedFineRupees > 0 && (
                      <Pill tone="red">{rupees(h.accruedFineRupees)} so far</Pill>
                    )}
                  </View>
                </View>
              ))
            )}
          </Page>

          {shelf.finesEnabled && (
            <>
              <SectionTitle title="Fines" />
              <Page>
                {shelf.fines.length === 0 ? (
                  <Empty>No fines — everything’s on time.</Empty>
                ) : (
                  shelf.fines.map((f, i) => (
                    <View
                      key={f.id}
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        paddingVertical: 10,
                        paddingHorizontal: 14,
                        borderTopWidth: i === 0 ? 0 : 1,
                        borderTopColor: tokens.color.line,
                      }}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '600', color: tokens.color.ink }}>
                          {f.title}
                        </Text>
                        <Text style={{ fontSize: 11, color: tokens.color.sub }}>
                          {f.reason === 'LOST' ? 'lost — replacement' : 'returned late'}
                        </Text>
                      </View>
                      <Pill tone="red">{rupees(f.amountRupees)}</Pill>
                    </View>
                  ))
                )}
              </Page>
              {shelf.finesDueRupees > 0 && (
                <Text style={{ fontSize: 11, color: tokens.color.sub, marginHorizontal: 4 }}>
                  {rupees(shelf.finesDueRupees)} due — pay at the counter.
                </Text>
              )}
            </>
          )}

          <SectionTitle title="History" />
          <Page>
            {shelf.history.length === 0 ? (
              <Empty>No history yet.</Empty>
            ) : (
              shelf.history.map((h, i) => (
                <View
                  key={h.issueId}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: tokens.color.line,
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{ flex: 1, fontSize: 13, fontWeight: '600', color: tokens.color.ink2 }}
                  >
                    {h.title}
                  </Text>
                  <Text style={{ fontSize: 11, color: tokens.color.sub }}>
                    {h.wasLost ? 'lost' : `returned ${fmtDay(h.returnedOn)}`}
                  </Text>
                </View>
              ))
            )}
          </Page>
        </>
      )}
    </Screen>
  );
}
