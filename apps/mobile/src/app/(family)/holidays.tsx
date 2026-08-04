import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { holidayDateParts, type Holiday } from '@/lib/portal';
import { Card, Empty, Page, Pill, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

const TYPE_TONE = { PUBLIC: 'green', FESTIVAL: 'amber', SCHOOL: 'indigo' } as const;

/**
 * `Holiday.type` has no DB-level enum — only `@IsIn`-validated at write time
 * (packages/db/prisma/schema.prisma) — so an unexpected value here is
 * defensible, not impossible. `?? 'neutral'` keeps this indexed lookup safe
 * even before `Pill`'s own fallback; belt-and-suspenders per the same
 * finding.
 */
function typeTone(type: Holiday['type']): 'green' | 'amber' | 'indigo' | 'neutral' {
  return TYPE_TONE[type] ?? 'neutral';
}

/**
 * Days the school is shut. Paper skin only — no motion: a holiday list is a
 * printed calendar page, and nothing on it happens while you are looking at
 * it. The date sits in an amber `.day`-style cell (the same torn-off-calendar
 * cell the timetable strip uses) with the serif numeral, so the two screens
 * read as pages of one book.
 */
export default function Holidays() {
  const tokens = useTokens();
  const [items, setItems] = useState<Holiday[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refetch on focus, same as Notices — a holiday the admin adds while the
  // app is backgrounded should show up without a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      api
        .request<Holiday[]>('/me/holidays')
        .then((data) => {
          if (!cancelled) setItems(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return (
    <Screen>
      <SectionTitle title="Holidays" />
      <Text style={{ fontSize: 11, color: tokens.color.sub, marginHorizontal: 4, marginTop: -6 }}>
        Configured by your school admin on the web portal.
      </Text>

      {error && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{error}</Text>
        </Card>
      )}
      {items === null && !error && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading holidays…</Text>
        </Card>
      )}
      {items?.length === 0 && !error && (
        <Page>
          <Empty>No upcoming holidays.</Empty>
        </Page>
      )}
      {items && items.length > 0 && (
        <Page>
          {items.map((h, i) => {
            const { day, weekday } = holidayDateParts(h.startDate);
            return (
              <View
                key={h.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 11,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: tokens.color.line,
                }}
              >
                <View
                  style={{
                    width: 44,
                    borderWidth: 1,
                    borderColor: tokens.color.amber,
                    backgroundColor: tokens.color.amber50,
                    borderRadius: 11,
                    paddingTop: 5,
                    paddingBottom: 6,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 8.5, fontWeight: '800', letterSpacing: 0.5, color: tokens.color.late }}>
                    {weekday.toUpperCase()}
                  </Text>
                  <Text style={{ fontFamily: font.serif, fontSize: 15, color: tokens.color.late }}>{day}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12.5, fontWeight: '600', color: tokens.color.ink }}>{h.name}</Text>
                </View>
                <Pill tone={typeTone(h.type)}>{h.type}</Pill>
              </View>
            );
          })}
        </Page>
      )}
    </Screen>
  );
}
