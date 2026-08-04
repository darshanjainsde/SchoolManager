import { useCallback, useState, type ReactNode } from 'react';
import { Animated, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { holidayDateParts, type Holiday } from '@/lib/portal';
import { Card, Pill, Screen, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';
import { DUR, pinStyle, useGesture } from '@/theme/motion';

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
        <Card>
          <Text style={{ color: tokens.color.sub }}>No upcoming holidays.</Text>
        </Card>
      )}
      {items?.map((h, i) => {
        const { day, weekday } = holidayDateParts(h.startDate);
        return (
          <PinnedNotice key={h.id} index={i}>
            {/* ORDINARY PAPER. The repaint painted the whole card amber and
                set the holiday's name AND its weekday in amber ink on top of
                it — so a list of holidays became one uninterrupted block of
                colour with its lowest-contrast text in the middle of it. The
                tint stays where it reads: on the date cell, and on the type
                Pill that already colour-codes the row. */}
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  backgroundColor: tokens.color.indigo50,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {/* The date numeral in the serif, the way a wall calendar
                    prints it. */}
                <Text style={{ fontFamily: font.serif, fontSize: 18, fontWeight: '700', color: tokens.color.indigo }}>
                  {day}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: tokens.color.ink }}>{h.name}</Text>
                <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>{weekday}</Text>
              </View>
              <Pill tone={typeTone(h.type)}>{h.type}</Pill>
            </Card>
          </PinnedNotice>
        );
      })}
    </Screen>
  );
}
