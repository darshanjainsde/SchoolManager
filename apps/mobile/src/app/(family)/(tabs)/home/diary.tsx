import { useCallback, useState, type ReactNode } from 'react';
import { Animated, Pressable, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useFocusEffect } from 'expo-router';
import type { DiarySignResult, StudentDiaryEntry, StudentDiaryResult } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { Empty, Page, Pill, RowWash, Screen, SectionTitle, Toast } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';
import { DASH, DUR, pinStyle, strokeDashoffset, useGesture } from '@/theme/motion';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** `2026-08-03` → `Mon, 3 Aug` — the header on a diary page. */
function dayLabel(iso: string, today: string): string {
  if (iso === today) return 'Today';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function todayISO(): string {
  return new Date().toLocaleDateString('en-CA');
}

/**
 * THE SIGNATURE — the sixth gesture, and the only one that draws a human
 * mark rather than a machine one.
 *
 * The pitch's `.sig`: a 46×16 flourish whose stroke-dash offset runs from 70
 * to 0 over 800ms (`sigdraw`), so the line appears to be WRITTEN rather than
 * to appear. It matters that this one is slow and hand-shaped: acknowledging
 * a remark is the single act in this app that carries weight at home, and a
 * checkmark popping into place would make it feel like dismissing a
 * notification. A drawn signature says a person did this.
 *
 * `native: false` because `strokeDashoffset` is an SVG attribute, not a
 * transform, so it cannot be driven off the UI thread. Under reduce-motion
 * `useGesture` snaps the offset to 0 and the mark is simply there.
 */
function SignatureMark() {
  const tokens = useTokens();
  const draw = useGesture(true, DUR.signature, { native: false });
  return (
    <Svg width={46} height={16} viewBox="0 0 46 16">
      <AnimatedPath
        d="M2 12 C8 2 11 14 16 7 S24 12 30 6 S40 12 44 5"
        fill="none"
        stroke={tokens.color.ink}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeDasharray={DASH.signature}
        strokeDashoffset={strokeDashoffset(draw, DASH.signature) as unknown as number}
      />
    </Svg>
  );
}

/**
 * One line of the page the child brings home — the pitch's `.diary-item`.
 *
 * THE PIN (`pinin`, 400ms, staggered by index): every entry drops onto the
 * page from above, slightly askew, and settles. Entries are not a feed that
 * scrolls past; they are slips of paper going up, and the gesture is what
 * keeps the diary reading as an object rather than as a timeline.
 *
 * A REMARK gets the red margin rule, the red wash bleeding in from it, and a
 * body set in SERIF ITALIC — the teacher's own hand, visibly not the app's.
 */
function DiaryItem({
  entry,
  index,
  first,
  children,
}: {
  entry: StudentDiaryEntry;
  index: number;
  first: boolean;
  children?: ReactNode;
}) {
  const tokens = useTokens();
  const pin = useGesture(true, DUR.pin, { delay: index * 90 });
  const red = entry.kind === 'REMARK';

  return (
    <Animated.View
      testID={`diary-${entry.id}`}
      style={[
        {
          flexDirection: 'row',
          gap: 9,
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderTopWidth: first ? 0 : 1,
          borderTopColor: tokens.color.line,
          borderLeftWidth: red ? 3 : 0,
          borderLeftColor: tokens.color.red,
          overflow: 'hidden',
        },
        pinStyle(pin),
      ]}
    >
      {red && <RowWash color={tokens.color.red50} endStop={0.92} />}
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          marginTop: 5,
          backgroundColor: red ? tokens.color.red : tokens.color.indigo,
        }}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text
            style={{
              fontSize: 10.5,
              fontWeight: '800',
              letterSpacing: 0.5,
              color: red ? tokens.color.red : tokens.color.indigo,
            }}
          >
            {(entry.subjectName ?? 'Diary').toUpperCase()}
          </Text>
          {red && (
            <View
              style={{
                backgroundColor: tokens.color.red,
                borderRadius: 4,
                paddingVertical: 1.5,
                paddingHorizontal: 6,
              }}
            >
              <Text
                style={{
                  fontSize: 9,
                  fontWeight: '800',
                  letterSpacing: 0.8,
                  color: tokens.color.onBrand,
                }}
              >
                REMARK
              </Text>
            </View>
          )}
        </View>

        <Text
          style={{
            color: tokens.color.ink,
            fontSize: 14.5,
            lineHeight: 21,
            marginTop: 1,
            ...(red ? { fontFamily: font.serif, fontStyle: 'italic' as const } : null),
          }}
        >
          {entry.body}
        </Text>

        <Text style={{ color: tokens.color.sub, fontSize: 11, marginTop: 2 }}>
          {entry.teacherName}
          {entry.personal ? ' · for you' : ' · whole class'}
          {red ? ' · ✉️ emailed home' : ''}
        </Text>

        {children}
      </View>
    </Animated.View>
  );
}

/**
 * The family's diary (Phase 5·3) — the page the child brings home, grouped by
 * day, newest first.
 *
 * A red-ink REMARK carries a signature line the way the paper one does:
 * whoever signs types their name, taps sign, and the teacher's page shows it
 * signed. The copy is explicit that the email already went home, so nobody
 * reads signing as "and now the school knows" — the school told them first.
 *
 * COPY IS ROLE-NEUTRAL on purpose: one STUDENT login serves both the student
 * and whoever at home uses it, so nothing here may address "you" as a parent
 * (enforced by `__tests__/role-neutral-copy.test.ts`). Hence "emailed home"
 * and "who is signing", never "your parents" / "parent's name".
 */
export default function FamilyDiary() {
  const tokens = useTokens();
  const [data, setData] = useState<StudentDiaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [signing, setSigning] = useState<string | null>(null);
  const today = todayISO();

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      api
        .request<StudentDiaryResult>('/me/diary')
        .then((d) => {
          if (!cancelled) setData(d);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not open the diary.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const sign = async (entry: StudentDiaryEntry) => {
    const name = (drafts[entry.id] ?? '').trim();
    if (!name) return;
    setSigning(entry.id);
    setError(null);
    try {
      const res = await api.request<DiarySignResult>(`/me/diary/${entry.id}/sign`, {
        method: 'POST',
        body: { signedName: name },
      });
      setData((d) =>
        d
          ? {
              entries: d.entries.map((e) =>
                e.id === entry.id ? { ...e, signedAt: res.signedAt, signedName: res.signedName } : e,
              ),
              unsignedCount: res.unsignedCount,
            }
          : d,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save that signature.');
    } finally {
      setSigning(null);
    }
  };

  // Group by day so the diary reads as pages, not as a feed.
  const days: { date: string; entries: StudentDiaryEntry[] }[] = [];
  for (const entry of data?.entries ?? []) {
    const last = days[days.length - 1];
    if (last && last.date === entry.date) last.entries.push(entry);
    else days.push({ date: entry.date, entries: [entry] });
  }

  return (
    <Screen>
      <SectionTitle
        title="Diary"
        right={
          data && data.unsignedCount > 0 ? (
            <View testID="diary-unsigned">
              <Pill tone="red">{`${data.unsignedCount} to sign`}</Pill>
            </View>
          ) : undefined
        }
      />

      {error && <Toast kind="error" message={error} />}

      {data === null && !error && (
        <Page>
          <Empty>Opening the diary…</Empty>
        </Page>
      )}

      {data?.entries.length === 0 && (
        <Page>
          <Empty icon="diary">Nothing in the diary this month. Anything a teacher writes turns up here.</Empty>
        </Page>
      )}

      {days.map((day) => (
        <View key={day.date} style={{ gap: 9 }}>
          <Text
            style={{
              fontSize: 13,
              fontFamily: font.serif,
              fontStyle: 'italic',
              color: tokens.color.sub,
              marginLeft: 4,
              marginTop: 4,
            }}
          >
            {dayLabel(day.date, today)}
          </Text>

          <Page>
            {day.entries.map((e, i) => {
              const red = e.kind === 'REMARK';
              const busy = signing === e.id || !(drafts[e.id] ?? '').trim();
              return (
                <DiaryItem key={e.id} entry={e} index={i} first={i === 0}>
                  {red &&
                    (e.signedAt ? (
                      // The pitch's `.signed` — the mark, then who made it.
                      <View
                        testID={`signed-${e.id}`}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                          marginTop: 7,
                        }}
                      >
                        <SignatureMark />
                        <Text
                          style={{ color: tokens.color.green, fontSize: 11, fontWeight: '700' }}
                        >
                          Signed
                        </Text>
                        <Text style={{ color: tokens.color.sub, fontSize: 11.5 }}>
                          by {e.signedName}
                        </Text>
                      </View>
                    ) : (
                      <View style={{ gap: 8, marginTop: 7 }}>
                        <Text style={{ color: tokens.color.sub, fontSize: 11.5 }}>
                          A copy has already been emailed home. Sign to tell the teacher it was
                          read.
                        </Text>
                        <TextInput
                          testID={`sign-name-${e.id}`}
                          value={drafts[e.id] ?? ''}
                          onChangeText={(v) => setDrafts((d) => ({ ...d, [e.id]: v }))}
                          placeholder="Who is signing?"
                          placeholderTextColor={tokens.color.placeholder}
                          autoCapitalize="words"
                          style={{
                            backgroundColor: tokens.color.surface,
                            borderColor: tokens.color.line,
                            borderWidth: 1.5,
                            borderRadius: 11,
                            paddingVertical: 10,
                            paddingHorizontal: 12,
                            fontSize: 14,
                            color: tokens.color.ink,
                          }}
                        />
                        {/* Signing IS this screen's primary action — it is the
                            only thing anyone at home is being asked to do, and
                            the teacher is waiting on it. The repaint shrank it
                            to a 30dp outlined chip pushed to the left margin,
                            under the minimum comfortable touch target. Full
                            width, filled, and at button size. */}
                        <Pressable
                          testID={`sign-${e.id}`}
                          onPress={() => sign(e)}
                          disabled={busy}
                          style={({ pressed }) => ({
                            backgroundColor: tokens.color.red,
                            opacity: busy ? 0.45 : pressed ? 0.85 : 1,
                            borderRadius: 12,
                            paddingVertical: 11,
                          })}
                        >
                          <Text
                            style={{
                              color: tokens.color.onBrand,
                              fontWeight: '700',
                              textAlign: 'center',
                              fontSize: 13.5,
                            }}
                          >
                            {signing === e.id ? 'Signing…' : '✍️ Sign this remark'}
                          </Text>
                        </Pressable>
                      </View>
                    ))}
                </DiaryItem>
              );
            })}
          </Page>
        </View>
      ))}
    </Screen>
  );
}
