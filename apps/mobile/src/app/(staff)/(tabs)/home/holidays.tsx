import { useReload } from '@/lib/query';
import { useCallback, useState, type ReactNode } from 'react';
import { Animated, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { holidayDateParts, type Holiday } from '@/lib/portal';
import { Card, ErrorState, Pill, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { DUR, pinStyle, useGesture } from '@/theme/motion';
import { holidayTypeLabel } from '@/lib/labels';

const TYPE_TONE = { PUBLIC: 'green', FESTIVAL: 'amber', SCHOOL: 'indigo' } as const;

/**
 * THE PIN (`.notice.pin`) — a holiday is a note pinned to the term calendar,
 * so it drops in slightly askew and settles. The staggered arrival is what
 * makes the list read as a board being filled rather than a table loading.
 * Each row fires once, on the render it first appears in.
 */
function PinnedNotice({ index, children }: { index: number; children: ReactNode }) {
  const drop = useGesture(true, DUR.pin, { delay: Math.min(index, 6) * 70 });
  return <Animated.View style={pinStyle(drop)}>{children}</Animated.View>;
}

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

export default function Holidays() {
  const tokens = useTokens();
  // Try again / pull-to-refresh for this screen's own focus effect.
  const [reloadKey, reload] = useReload();
  const [items, setItems] = useState<Holiday[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refetch on focus — a holiday the admin adds while the app is
  // backgrounded should show up without a manual pull-to-refresh.
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
        <Card>
          <Text style={{ color: tokens.color.sub }}>No upcoming holidays.</Text>
        </Card>
      )}
      {items?.map((h, i) => {
        const { day, weekday } = holidayDateParts(h.startDate);
        const month = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][new Date(h.startDate).getUTCMonth()];
        return (
          <PinnedNotice key={h.id} index={i}>
            {/* ORDINARY PAPER. The repaint painted the whole card amber and
                set the holiday's name AND its weekday in amber ink on top of
                it — so a list of holidays became one uninterrupted block of
                colour with its lowest-contrast text in the middle of it. The
                tint stays where it reads: on the date cell, and on the type
                Pill that already colour-codes the row. */}
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
              {/* Month over day, like the accounts Today tile: a bare "20"
                  said nothing about WHEN (v2 crawl 2026-10-08). */}
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
                <Text style={{ fontSize: 17, lineHeight: 20, fontWeight: '700', color: tokens.color.indigo, fontVariant: ['tabular-nums'] }}>
                  {day}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: tokens.color.ink }}>{h.name}</Text>
                <Text style={{ fontSize: 13, color: tokens.color.sub, marginTop: 2 }}>{weekday}</Text>
              </View>
              <Pill tone={typeTone(h.type)}>{holidayTypeLabel(h.type)}</Pill>
            </Card>
          </PinnedNotice>
        );
      })}
    </Screen>
  );
}
