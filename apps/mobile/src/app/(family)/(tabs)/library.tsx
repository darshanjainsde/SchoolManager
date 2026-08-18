import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { MeLibraryPayload } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { dueChipLabel, dueTone, fmtDay, ribbonPct, rupees } from '@/lib/library';
import { Card, Empty, Page, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/**
 * The student's own shelf — the approved "bookmark ribbon" screen. Everything
 * on it is the server's answer to GET /me/library (the same endpoint the web
 * portal tab reads): due dates, days left and fines are computed once, on the
 * API, so a book issued at the counter a second ago is already here with the
 * same numbers the librarian saw. The app stores nothing.
 *
 * The ribbon on each card's right edge drains as the due date nears — green,
 * then amber (≤3 days), then a red stub once overdue — and the chip says the
 * same thing in words, so colour never carries the message alone.
 */
export default function FamilyLibrary() {
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
          // The tab is plan-gated, but a deep link or a plan change mid-session
          // can still land here — say so quietly rather than erroring.
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

  const free = shelf ? Math.max(0, shelf.limit - shelf.holdings.length) : 0;
  const RIBBON = { green: tokens.color.green, amber: tokens.color.amber, red: tokens.color.red } as const;
  const CHIP = {
    green: { bg: tokens.color.green50, fg: tokens.color.green },
    amber: { bg: tokens.color.amber50, fg: tokens.color.late },
    red: { bg: tokens.color.red50, fg: tokens.color.red },
  } as const;

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
          {/* The limit, always visible — the counter warns against the same number. */}
          <View
            testID="limit-banner"
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              backgroundColor: tokens.color.indigo50,
              borderRadius: tokens.radius.card,
              paddingHorizontal: 13,
              paddingVertical: 10,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: tokens.color.indigo }}>
              Holding {shelf.holdings.length} of {shelf.limit}
            </Text>
            <Text style={{ fontSize: 12, fontWeight: '600', color: tokens.color.indigo }}>
              {free > 0 ? `you can borrow ${free} more` : 'return one to borrow more'}
            </Text>
          </View>

          {shelf.finesEnabled && shelf.finesDueRupees > 0 && (
            <View
              testID="fine-banner"
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                backgroundColor: tokens.color.red50,
                borderRadius: tokens.radius.card,
                paddingHorizontal: 13,
                paddingVertical: 10,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: tokens.color.red }}>
                {rupees(shelf.finesDueRupees)} to clear at the counter
              </Text>
              <Text style={{ fontSize: 11, fontWeight: '600', color: tokens.color.red }}>
                {shelf.fines.length > 0
                  ? `${shelf.fines.length} fine${shelf.fines.length === 1 ? '' : 's'}`
                  : 'grows daily while a book is late'}
              </Text>
            </View>
          )}

          {shelf.holdings.length === 0 ? (
            <Page>
              <Empty icon="library">No books at home. The shelf awaits!</Empty>
            </Page>
          ) : (
            <Page>
              {shelf.holdings.map((h, i) => {
                const tone = dueTone(h.daysLeft);
                const chip = CHIP[tone];
                return (
                  <View
                    key={h.issueId}
                    style={{
                      paddingVertical: 12,
                      paddingLeft: 14,
                      paddingRight: 34,
                      gap: 5,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: tokens.color.line,
                    }}
                  >
                    {/* The bookmark ribbon — length is time left, colour is urgency. */}
                    <View
                      testID={`ribbon-${tone}`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        right: 13,
                        width: 8,
                        height: `${ribbonPct(h.daysLeft, shelf.loanDays)}%`,
                        borderBottomLeftRadius: 2,
                        borderBottomRightRadius: 2,
                        backgroundColor: RIBBON[tone],
                      }}
                    />
                    <Text style={{ fontFamily: font.serif, fontSize: 15, fontWeight: '600', color: tokens.color.ink }}>
                      {h.title}
                    </Text>
                    <Text style={{ fontSize: 11, color: tokens.color.sub }}>
                      {h.author} · {h.accessionNo}
                    </Text>
                    <View
                      style={{
                        alignSelf: 'flex-start',
                        backgroundColor: chip.bg,
                        borderRadius: tokens.radius.chip,
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                      }}
                    >
                      <Text style={{ fontSize: 11, fontWeight: '700', color: chip.fg }}>
                        {dueChipLabel(h.daysLeft, h.dueOn, shelf.finesEnabled ? h.accruedFineRupees : 0)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </Page>
          )}

          <SectionTitle title="History" />
          <Page>
            {shelf.history.length === 0 ? (
              <Empty>Nothing returned yet.</Empty>
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
