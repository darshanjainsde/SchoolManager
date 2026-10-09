import { useReload } from '@/lib/query';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { holidayDateParts, type Holiday } from '@/lib/portal';
import { Card, Empty, ErrorState, Page, Pill, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { holidayTypeLabel } from '@/lib/labels';

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
  // Try again / pull-to-refresh for this screen's own focus effect.
  const [reloadKey, reload] = useReload();
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
    }, [reloadKey]),
  );

  return (
    <Screen onRefresh={reload}>
      <SectionTitle title="Holidays" />
      <Text style={{ fontSize: 11, color: tokens.color.sub, marginHorizontal: 4, marginTop: -6 }}>
        Configured by your school admin on the web portal.
      </Text>

      {error && <ErrorState error={error} onRetry={reload} />}
      {items === null && !error && (
        <LoadingRows label="Loading holidays…" rows={4} />
      )}
      {items?.length === 0 && !error && (
        <Page>
          <Empty icon="holidays">No upcoming holidays.</Empty>
        </Page>
      )}
      {items && items.length > 0 && (
        <Page>
          {items.map((h, i) => {
            const { day, weekday } = holidayDateParts(h.startDate);
            const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][new Date(h.startDate).getUTCMonth()];
            return (
              <View
                key={h.id}
                testID={`holiday-${h.id}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  minHeight: 72,
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: tokens.color.line,
                }}
              >
                {/* Month over day, the same cell as the teacher's Holidays:
                    "FRI 25" alone never said WHICH month (audit 9 Oct 2026). */}
                <View
                  style={{
                    width: 44,
                    height: 48,
                    borderRadius: tokens.radius.field,
                    backgroundColor: tokens.color.indigo50,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.5, color: tokens.color.indigo }}>{month}</Text>
                  <Text style={{ fontSize: 17, lineHeight: 20, fontWeight: '700', color: tokens.color.indigo, fontVariant: ['tabular-nums'] }}>{day}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: tokens.color.ink }}>{h.name}</Text>
                  <Text style={{ fontSize: 13, color: tokens.color.sub, marginTop: 2 }}>{weekday}</Text>
                </View>
                <Pill tone={typeTone(h.type)}>{holidayTypeLabel(h.type)}</Pill>
              </View>
            );
          })}
        </Page>
      )}
    </Screen>
  );
}
