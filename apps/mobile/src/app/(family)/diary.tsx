import { useCallback, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { DiarySignResult, StudentDiaryEntry, StudentDiaryResult } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { Card, Pill, Screen, SectionTitle, Toast } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';

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
        <Card>
          <Text style={{ color: tokens.color.sub }}>Opening the diary…</Text>
        </Card>
      )}

      {data?.entries.length === 0 && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>
            Nothing in the diary this month. Anything a teacher writes turns up here.
          </Text>
        </Card>
      )}

      {days.map((day) => (
        <View key={day.date} style={{ gap: 9 }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: '700',
              color: tokens.color.sub,
              marginLeft: 4,
              marginTop: 4,
            }}
          >
            {dayLabel(day.date, today)}
          </Text>

          {day.entries.map((e) => {
            const red = e.kind === 'REMARK';
            return (
              <Card key={e.id} testID={`diary-${e.id}`}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {/* The margin rule of a paper diary — red for a remark. */}
                  <View
                    style={{
                      width: 3,
                      borderRadius: 2,
                      backgroundColor: red ? tokens.color.red : tokens.color.indigo50,
                    }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: red ? tokens.color.red : tokens.color.ink,
                        fontSize: 14.5,
                        lineHeight: 21,
                        fontStyle: red ? 'italic' : 'normal',
                      }}
                    >
                      {e.body}
                    </Text>
                    <Text style={{ color: tokens.color.sub, fontSize: 11.5, marginTop: 8 }}>
                      {e.teacherName}
                      {e.subjectName ? ` · ${e.subjectName}` : ''}
                      {e.personal ? ' · for you' : ''}
                    </Text>
                  </View>
                </View>

                {red && (
                  <View style={{ marginTop: 12 }}>
                    {e.signedAt ? (
                      <View testID={`signed-${e.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Pill tone="green">Signed</Pill>
                        <Text style={{ color: tokens.color.sub, fontSize: 11.5 }}>
                          by {e.signedName}
                        </Text>
                      </View>
                    ) : (
                      <View style={{ gap: 8 }}>
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
                            borderRadius: 12,
                            paddingVertical: 10,
                            paddingHorizontal: 12,
                            fontSize: 14,
                            color: tokens.color.ink,
                          }}
                        />
                        <Pressable
                          testID={`sign-${e.id}`}
                          onPress={() => sign(e)}
                          disabled={signing === e.id || !(drafts[e.id] ?? '').trim()}
                          style={({ pressed }) => ({
                            backgroundColor: tokens.color.red,
                            opacity:
                              signing === e.id || !(drafts[e.id] ?? '').trim()
                                ? 0.45
                                : pressed
                                  ? 0.85
                                  : 1,
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
                            {signing === e.id ? 'Signing…' : 'Sign this remark'}
                          </Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                )}
              </Card>
            );
          })}
        </View>
      ))}
    </Screen>
  );
}
