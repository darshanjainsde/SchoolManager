import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type {
  DiaryEntryRow,
  DiaryPageResult,
  MyClassSection,
  RosterStudent,
} from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { shiftISO, todayISO } from '@/lib/attendance';
import { Card, Pill, Screen, SectionTitle, Toast } from '@/components/ui';
import { StudentPicker, type PickableStudent } from '@/components/StudentPicker';
import { useTokens } from '@/theme/theme-context';

type Kind = 'ITEM' | 'REMARK';

/**
 * The teacher's diary page (Phase 5·3) — one class, one day, written the way
 * the paper one is: pick the class, write the line, and either it goes to
 * everybody or you name the children it is about.
 *
 * The REMARK toggle is deliberately a mode switch rather than a separate
 * screen: the same words, the same picker, the same send button, with the
 * ink turning red and the copy telling the truth about what happens next
 * ("their parents get this by email"). A teacher should never have to wonder
 * whether a remark was actually delivered.
 *
 * Past days are readable but not writable — the compose card disappears
 * entirely rather than showing a disabled form, because the reason ("ink
 * dries") belongs in one sentence, not in five greyed-out controls.
 */
export default function StaffDiary() {
  const tokens = useTokens();
  const [date, setDate] = useState(todayISO());
  const [classes, setClasses] = useState<MyClassSection[] | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  const [page, setPage] = useState<DiaryPageResult | null>(null);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<Kind>('ITEM');
  const [body, setBody] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const today = todayISO();
  const isToday = date === today;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api
        .request<MyClassSection[]>('/manage/attendance/my-classes')
        .then((data) => {
          if (cancelled) return;
          setClasses(data);
          setClassId((prev) => prev ?? data[0]?.classSectionId ?? null);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load your classes.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // The page itself, plus the roster the picker types against.
  useFocusEffect(
    useCallback(() => {
      if (!classId) return;
      let cancelled = false;
      setError(null);
      setPage(null);
      (async () => {
        try {
          const [p, r] = await Promise.all([
            api.request<DiaryPageResult>(`/manage/diary?classSectionId=${classId}&date=${date}`),
            api.request<RosterStudent[]>(`/manage/students?classSectionId=${classId}`),
          ]);
          if (cancelled) return;
          setPage(p);
          setRoster(r);
        } catch (e) {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not open the diary.');
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [classId, date]),
  );

  const pickable: PickableStudent[] = useMemo(
    () => roster.map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}`.trim(), rollNo: s.rollNo })),
    [roster],
  );

  const needsNames = kind === 'REMARK' || chosen.length > 0;
  const canSend = !saving && !!classId && body.trim().length > 0 && (kind !== 'REMARK' || chosen.length > 0);

  const send = async () => {
    if (!classId) return;
    setSaving(true);
    setError(null);
    setSent(null);
    try {
      const created = await api.request<DiaryEntryRow>('/manage/diary', {
        method: 'POST',
        body: {
          classSectionId: classId,
          date,
          kind,
          audience: chosen.length > 0 ? 'SELECTED' : 'ALL',
          body: body.trim(),
          ...(chosen.length > 0 ? { studentIds: chosen } : {}),
        },
      });
      setPage((p) => (p ? { ...p, entries: [...p.entries, created] } : p));
      setBody('');
      setChosen([]);
      setSent(
        created.kind === 'REMARK'
          ? `Remark written. ${created.students.length === 1 ? "That family has" : 'Those families have'} been emailed.`
          : 'Added to today’s diary.',
      );
      setKind('ITEM');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save that entry.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry: DiaryEntryRow) => {
    try {
      await api.request(`/manage/diary/${entry.id}`, { method: 'DELETE' });
      setPage((p) => (p ? { ...p, entries: p.entries.filter((e) => e.id !== entry.id) } : p));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not remove that entry.');
    }
  };

  const isRemark = kind === 'REMARK';

  return (
    <Screen>
      <SectionTitle title={`Diary · ${isToday ? 'today' : date}`} />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginHorizontal: 4,
        }}
      >
        <Pressable testID="diary-prev" onPress={() => setDate((d) => shiftISO(d, -1))}>
          <Text style={{ color: tokens.color.indigo, fontWeight: '700', fontSize: 13 }}>‹ Prev day</Text>
        </Pressable>
        {!isToday && (
          <Pressable testID="diary-today" onPress={() => setDate(today)}>
            <Text style={{ color: tokens.color.sub, fontWeight: '600', fontSize: 12 }}>Jump to today</Text>
          </Pressable>
        )}
        <Pressable
          testID="diary-next"
          onPress={() => setDate((d) => (d < today ? shiftISO(d, 1) : d))}
        >
          <Text
            style={{
              color: isToday ? tokens.color.placeholder : tokens.color.indigo,
              fontWeight: '700',
              fontSize: 13,
            }}
          >
            Next day ›
          </Text>
        </Pressable>
      </View>

      {classes && classes.length > 1 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {classes.map((c) => {
            const on = c.classSectionId === classId;
            return (
              <Pressable
                key={c.classSectionId}
                testID={`diary-class-${c.classSectionId}`}
                onPress={() => setClassId(c.classSectionId)}
                style={{
                  borderWidth: 1.5,
                  borderColor: on ? tokens.color.indigo : tokens.color.line,
                  backgroundColor: on ? tokens.color.indigo50 : tokens.color.surface,
                  borderRadius: 11,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                }}
              >
                <Text
                  style={{
                    fontSize: 12.5,
                    fontWeight: '700',
                    color: on ? tokens.color.indigo : tokens.color.sub,
                  }}
                >
                  {c.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {error && <Toast kind="error" message={error} />}
      {sent && <Toast kind="success" message={sent} testID="diary-sent" />}

      {isToday && (
        <Card testID="diary-compose">
          <View style={{ flexDirection: 'row', gap: 7, marginBottom: 11 }}>
            {(['ITEM', 'REMARK'] as const).map((k) => {
              const on = kind === k;
              const red = k === 'REMARK';
              return (
                <Pressable
                  key={k}
                  testID={`diary-kind-${k}`}
                  onPress={() => setKind(k)}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    paddingVertical: 9,
                    borderRadius: 11,
                    borderWidth: 1.5,
                    borderColor: on ? (red ? tokens.color.red : tokens.color.indigo) : tokens.color.line,
                    backgroundColor: on
                      ? red
                        ? tokens.color.red50
                        : tokens.color.indigo50
                      : tokens.color.surface,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12.5,
                      fontWeight: '700',
                      color: on ? (red ? tokens.color.red : tokens.color.indigo) : tokens.color.sub,
                    }}
                  >
                    {k === 'ITEM' ? 'Diary entry' : 'Remark'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            testID="diary-body"
            value={body}
            onChangeText={setBody}
            multiline
            placeholder={
              isRemark
                ? 'What happened, in your words — the parent reads this verbatim.'
                : 'Homework, what to bring tomorrow, a note home…'
            }
            placeholderTextColor={tokens.color.placeholder}
            style={{
              minHeight: 88,
              textAlignVertical: 'top',
              backgroundColor: tokens.color.surface,
              borderColor: isRemark ? tokens.color.red : tokens.color.line,
              borderWidth: 1.5,
              borderRadius: 13,
              padding: 13,
              fontSize: 14.5,
              color: isRemark ? tokens.color.red : tokens.color.ink,
            }}
          />

          <Text style={{ color: tokens.color.sub, fontSize: 11.5, marginTop: 9, marginBottom: 7 }}>
            {isRemark
              ? 'A remark is always emailed to the parents of the children you name — signing it in the app does not replace that.'
              : 'Leave the names empty and the whole class gets it. Name someone and only they do.'}
          </Text>

          <StudentPicker
            students={pickable}
            selected={chosen}
            onChange={setChosen}
            testID="diary-picker"
            placeholder={isRemark ? 'Who is this about?' : 'Only for… (optional)'}
          />

          <Pressable
            testID="diary-send"
            onPress={send}
            disabled={!canSend}
            style={({ pressed }) => ({
              marginTop: 12,
              backgroundColor: isRemark ? tokens.color.red : tokens.color.indigo,
              opacity: !canSend ? 0.45 : pressed ? 0.85 : 1,
              borderRadius: 13,
              paddingVertical: 13,
            })}
          >
            <Text
              style={{
                color: tokens.color.onBrand,
                fontWeight: '700',
                textAlign: 'center',
                fontSize: 14,
              }}
            >
              {saving
                ? 'Saving…'
                : isRemark
                  ? `Write remark${chosen.length ? ` · ${chosen.length}` : ''}`
                  : needsNames
                    ? `Add for ${chosen.length}`
                    : 'Add for the whole class'}
            </Text>
          </Pressable>
        </Card>
      )}

      {!isToday && (
        <Card>
          <Text style={{ color: tokens.color.sub, fontSize: 12.5 }}>
            This page is closed — a diary a family has already read cannot be rewritten. Jump to
            today to add anything new.
          </Text>
        </Card>
      )}

      <SectionTitle title={page ? `${page.className} · ${page.entries.length} entries` : 'Entries'} />

      {page === null && !error && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Opening the diary…</Text>
        </Card>
      )}
      {page?.entries.length === 0 && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>
            {isToday ? 'Nothing written yet today.' : 'Nothing was written on this day.'}
          </Text>
        </Card>
      )}

      {page?.entries.map((e) => {
        const red = e.kind === 'REMARK';
        return (
          <Card key={e.id} testID={`diary-entry-${e.id}`}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
              <Text
                style={{
                  flex: 1,
                  color: red ? tokens.color.red : tokens.color.ink,
                  fontSize: 14,
                  lineHeight: 20,
                  fontStyle: red ? 'italic' : 'normal',
                }}
              >
                {e.body}
              </Text>
              {red && <Pill tone="red">Remark</Pill>}
            </View>

            {e.students.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 9 }}>
                {e.students.map((s) => (
                  <View
                    key={s.studentId}
                    style={{
                      backgroundColor: tokens.color.surfaceMuted,
                      borderRadius: tokens.radius.chip,
                      paddingVertical: 4,
                      paddingHorizontal: 9,
                    }}
                  >
                    <Text style={{ color: tokens.color.sub, fontSize: 11, fontWeight: '600' }}>
                      {s.name}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <Text style={{ color: tokens.color.sub, fontSize: 11.5, marginTop: 9 }}>
              {e.authorName}
              {e.subjectName ? ` · ${e.subjectName}` : ''}
              {' · '}
              {red
                ? `${e.signedCount}/${e.recipientCount} signed`
                : `${e.seenCount}/${e.recipientCount} opened`}
            </Text>

            {e.editable && (
              <Pressable
                testID={`diary-remove-${e.id}`}
                onPress={() => remove(e)}
                style={{ alignSelf: 'flex-start', marginTop: 9 }}
              >
                <Text style={{ color: tokens.color.red, fontSize: 12, fontWeight: '700' }}>
                  Strike out
                </Text>
              </Pressable>
            )}
          </Card>
        );
      })}
    </Screen>
  );
}
