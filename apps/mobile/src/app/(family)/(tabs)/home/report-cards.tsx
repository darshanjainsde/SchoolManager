import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { formatDate } from '@/lib/portal';
import { Empty, ErrorState, Page, PageHeader, Pill, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { Touchable } from '@/components/Touchable';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/** `GET /me/report-cards` — one row per card the office has issued for this child. */
export interface MyReportCard { id: string; serial: string; windowName: string; academicYearName: string; issuedAt: string }

/**
 * REPORT CARDS — the printed thing. The marks screen shows results as they
 * are published; this is the card the school pressed, signed and issued,
 * and the family keeps. Reached from Home; each card opens as a page.
 */
export default function ReportCards() {
  const tokens = useTokens();
  const q = useQuery<MyReportCard[]>('/me/report-cards');
  const d = q.data;

  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404) && !d) {
    return (
      <Screen>
        <SectionTitle title="Report cards" />
        <Page><Empty icon="report">Report cards aren’t switched on for your school yet.</Empty></Page>
      </Screen>
    );
  }

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <SectionTitle title="Report cards" />
      {q.loading && <LoadingRows label="Loading your report cards…" rows={2} />}
      {q.error && !d && <ErrorState error={q.error} onRetry={q.reload} />}
      {d && (
        <Page>
          <PageHeader title="Issued by the school" />
          {d.length === 0 ? (
            <Empty icon="report">No report card has been issued yet. It appears here the day the office prints it.</Empty>
          ) : (
            d.map((c, i) => (
              <Touchable
                key={c.id}
                testID={`report-card-${c.id}`}
                haptic="light"
                onPress={() => router.push(`/(family)/(tabs)/home/report-cards/${c.id}` as never)}
                accessibilityLabel={`${c.windowName}, ${c.academicYearName}, issued ${formatDate(c.issuedAt)}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: tokens.color.line }}
              >
                <Sheet />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: font.serif, fontSize: 14.5, fontWeight: '600', color: tokens.color.ink }} numberOfLines={1}>
                    {c.windowName}{c.academicYearName ? ` · ${c.academicYearName}` : ''}
                  </Text>
                  <Text style={{ fontSize: 11, color: tokens.color.sub, marginTop: 1 }}>Issued {formatDate(c.issuedAt)} · {c.serial}</Text>
                </View>
                <Pill tone="green">Ready</Pill>
              </Touchable>
            ))
          )}
        </Page>
      )}
    </Screen>
  );
}

/** A little sheet of paper with ruled lines — the card's thumbnail. */
function Sheet() {
  const tokens = useTokens();
  return (
    <View style={{ width: 30, height: 40, borderRadius: 3, borderWidth: 1, borderColor: tokens.color.line2, backgroundColor: tokens.color.appBg, padding: 5, gap: 4 }}>
      {[0, 1, 2, 3].map((i) => <View key={i} style={{ height: 2, backgroundColor: tokens.color.line2, width: i === 3 ? '60%' : '100%' }} />)}
    </View>
  );
}
