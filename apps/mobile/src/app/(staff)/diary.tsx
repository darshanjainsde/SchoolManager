import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Animated, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type {
  DiaryEntryRow,
  DiaryPageResult,
  MyClassSection,
  RosterStudent,
} from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { shiftISO, todayISO } from '@/lib/attendance';
import { Card, Empty, Page, RowWash, Screen, SectionTitle, Toast } from '@/components/ui';
import { StudentPicker, type PickableStudent } from '@/components/StudentPicker';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';
import { DUR, pinStyle, useGesture } from '@/theme/motion';

type Kind = 'ITEM' | 'REMARK';

/**
 * The pitch's date strip is six cells wide — Mon…Sat, one school week ending
 * at today. Not seven: nothing is written in the diary on a Sunday, and a
 * dead cell in a six-cell strip is a quarter of the control doing nothing.
 */
const STRIP_DAYS = 6;

/** `2026-08-03` → `{ dow: 'MON', num: '3' }` for one cell of the date strip. */
function cellLabels(iso: string): { dow: string; num: string } {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return {
    dow: dt.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase(),
    num: String(d),
  };
}

/** `2026-08-03` → `Mon, 3 Aug` — the accessible name of a date-strip cell. */
function longLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/**
 * One written line — the pitch's `.diary-item`.
 *
 * THE PIN: every line arrives from above, a couple of degrees askew,
 * overshoots and settles straight (`pinin`, 400ms). It is the gesture for
 * something being ADDED to a page, and it fires both when the day's entries
 * first land and when the teacher writes a new one, because from the page's
 * point of view those are the same event: a slip of paper going up on the
 * board. The `delay` staggers the day's lines so they pin one after another
 * rather than as a single slab.
 *
 * A REMARK is the one line written in a different pen: red margin rule,
 * a red wash bleeding in from that margin, and the body itself set in the
 * SERIF ITALIC — a teacher's own hand, not the app's voice.
 */
function DiaryItem({
  entry,
  index,
  first,
  children,
}: {
  entry: DiaryEntryRow;
  index: number;
  first: boolean;
  children?: ReactNode;
}) {
  const tokens = useTokens();
  const pin = useGesture(true, DUR.pin, { delay: index * 80 });
  const red = entry.kind === 'REMARK';
  const recipients =
    entry.students.length > 0
      ? `For: ${entry.students.map((s) => s.name.split(' ')[0]).join(', ')}`
      : 'Whole class';

  return (
    <Animated.View
      testID={`diary-entry-${entry.id}`}
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
            fontSize: 14,
            lineHeight: 20,
            marginTop: 1,
            ...(red ? { fontFamily: font.serif, fontStyle: 'italic' as const } : null),
          }}
        >
          {entry.body}
        </Text>

        <Text style={{ color: tokens.color.sub, fontSize: 11, marginTop: 2 }}>
          {entry.authorName}
          {' · '}
          {recipients}
        </Text>
        <Text
          style={{
            fontSize: 11,
            marginTop: 2,
            fontWeight: red ? '700' : '400',
            color: red
              ? entry.signedCount > 0
                ? tokens.color.green
                : tokens.color.red
              : tokens.color.sub,
          }}
        >
          {red
            ? `${entry.signedCount}/${entry.recipientCount} signed · ✉️ emailed`
            : `${entry.seenCount}/${entry.recipientCount} opened`}
        </Text>

        {children}
      </View>
    </Animated.View>
  );
}

/**
 * The receipt the pitch shows the moment a remark is pinned — `.emailcard`.
 *
 * It exists because "we emailed the family" is the single least believable
 * claim this screen makes, and a teacher who does not believe it will chase
 * the family by phone anyway. So the app shows the actual email: the subject
 * line, the teacher's own words HIGHLIGHTED in amber inside it (`mark`), and
 * the note that sending is not something signing can undo.
 *
 * THE PIN again (`pinin`, 450ms) — a despatch note going up on the board next
 * to the line that caused it.
 */
function EmailPreview({
  names,
  subject,
  author,
  body,
}: {
  names: string[];
  subject: string | null;
  author: string;
  body: string;
}) {
  const tokens = useTokens();
  const pin = useGesture(true, DUR.stamp);
  const first = names[0]?.split(' ')[0] ?? 'the student';
  return (
    <Animated.View
      testID="diary-email-preview"
      style={[
        {
          borderColor: tokens.color.line,
          borderWidth: 1.5,
          borderRadius: 12,
          backgroundColor: tokens.color.surface,
          paddingVertical: 11,
          paddingHorizontal: 12,
          marginTop: 9,
          shadowColor: tokens.color.ink,
          shadowOpacity: 0.08,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 7 },
          elevation: 2,
        },
        pinStyle(pin),
      ]}
    >
      <Text
        style={{
          fontSize: 10.5,
          fontWeight: '800',
          letterSpacing: 0.5,
          color: tokens.color.green,
        }}
      >
        {`✉️ EMAIL SENT · ${names.length} ${names.length === 1 ? 'family' : 'families'}`}
      </Text>
      <Text style={{ fontSize: 12.5, fontWeight: '700', marginTop: 5, color: tokens.color.ink }}>
        {`Subject: A remark in ${first}’s diary${subject ? ` — ${subject}` : ''}`}
      </Text>
      <Text style={{ fontSize: 12, color: tokens.color.ink2, marginTop: 3, lineHeight: 18 }}>
        {`${author} wrote today: `}
        <Text
          style={{
            backgroundColor: tokens.color.amber50,
            color: tokens.color.late,
            fontWeight: '700',
          }}
        >
          {` “${body}” `}
        </Text>
        {'\nOpen the diary to sign.'}
      </Text>
      <Text style={{ fontSize: 10, color: tokens.color.sub, marginTop: 5 }}>
        Sent the moment it’s pinned — signing can’t suppress it. Also bell + push.
      </Text>
    </Animated.View>
  );
}

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
  // The despatch note for the remark just written, if any — cleared by
  // anything that changes what is on the page, exactly as the pitch's
  // `#emailhost` is emptied on every rebuild.
  const [emailed, setEmailed] = useState<{
    names: string[];
    subject: string | null;
    author: string;
    body: string;
  } | null>(null);

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
      setEmailed(null);
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

  // The trailing school week, oldest first — the pitch's `DATES`.
  const strip = useMemo(() => {
    const out: string[] = [];
    for (let i = STRIP_DAYS - 1; i >= 0; i--) out.push(shiftISO(today, -i));
    return out;
  }, [today]);

  const prevISO = shiftISO(date, -1);
  const nextISO = shiftISO(date, 1);
  /**
   * The strip replaced the old ‹ Prev day / Next day › / Jump-to-today
   * buttons, but those three testIDs still name real, reachable affordances
   * — so they ride on the cells that DO the same thing (the day before the
   * selected one, the day after it, today) instead of being retired. Priority
   * order avoids the one collision: when yesterday is selected, "the next
   * day" and "today" are the same cell, and `diary-next` wins.
   */
  const cellTestID = (iso: string) => {
    if (iso === prevISO) return 'diary-prev';
    if (iso === nextISO) return 'diary-next';
    if (iso === today && !isToday) return 'diary-today';
    return `diary-day-${iso}`;
  };

  const needsNames = kind === 'REMARK' || chosen.length > 0;
  const canSend = !saving && !!classId && body.trim().length > 0 && (kind !== 'REMARK' || chosen.length > 0);

  const send = async () => {
    if (!classId) return;
    setSaving(true);
    setError(null);
    setSent(null);
    setEmailed(null);
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
      if (created.kind === 'REMARK') {
        setEmailed({
          names: created.students.map((s) => s.name),
          subject: created.subjectName,
          author: created.authorName,
          body: created.body,
        });
      }
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

      {/* THE DATE STRIP — the pitch's `.dstrip`. Six 44dp cells you scrub
          through with a thumb, replacing a pair of ‹ › buttons that made
          "three days ago" a three-tap guess. `.sel` is a solid indigo fill;
          `.today` keeps its amber border and tint even when another day is
          open, so "which day am I looking at" and "which day is it" stay two
          separate, simultaneously-readable facts. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, paddingHorizontal: 2, paddingTop: 4, paddingBottom: 8 }}
      >
        {strip.map((iso) => {
          const sel = iso === date;
          const isTodayCell = iso === today;
          const { dow, num } = cellLabels(iso);
          return (
            <Pressable
              key={iso}
              testID={cellTestID(iso)}
              accessibilityRole="button"
              accessibilityLabel={longLabel(iso)}
              accessibilityState={{ selected: sel }}
              onPress={() => setDate(iso)}
              style={{
                width: 44,
                alignItems: 'center',
                borderRadius: 11,
                borderWidth: 1,
                paddingTop: 6,
                paddingBottom: 7,
                borderColor: sel
                  ? tokens.color.indigo
                  : isTodayCell
                    ? tokens.color.amber
                    : tokens.color.line,
                backgroundColor: sel
                  ? tokens.color.indigo
                  : isTodayCell
                    ? tokens.color.amber50
                    : tokens.color.surface,
              }}
            >
              <Text
                style={{
                  fontSize: 9,
                  fontWeight: '800',
                  letterSpacing: 0.45,
                  color: sel ? tokens.color.onBrand : tokens.color.sub,
                }}
              >
                {dow}
              </Text>
              <Text
                style={{
                  fontFamily: font.serif,
                  fontSize: 15,
                  fontWeight: '600',
                  marginTop: 1,
                  color: sel ? tokens.color.onBrand : tokens.color.ink,
                }}
              >
                {num}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

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
          {/* The pitch's `.seg` — two halves of one control, because a diary
              entry and a remark are the same act of writing with a different
              pen, not two different features. `.sg.rem.on` turns the whole
              control red the moment the pen changes. */}
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 11 }}>
            {(['ITEM', 'REMARK'] as const).map((k) => {
              const on = kind === k;
              const red = k === 'REMARK';
              return (
                <Pressable
                  key={k}
                  testID={`diary-kind-${k}`}
                  onPress={() => {
                    setKind(k);
                    setEmailed(null);
                  }}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    paddingVertical: 9,
                    borderRadius: 10,
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
                    {k === 'ITEM' ? 'Diary entry' : 'Remark ✍️'}
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
              backgroundColor: isRemark ? tokens.color.red50 : tokens.color.surface,
              borderColor: isRemark ? tokens.color.red : tokens.color.line,
              borderWidth: 1.5,
              borderRadius: 11,
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
              borderRadius: 11,
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

          {emailed && (
            <EmailPreview
              names={emailed.names}
              subject={emailed.subject}
              author={emailed.author}
              body={emailed.body}
            />
          )}
        </Card>
      )}

      {!isToday && (
        <Page style={{ borderStyle: 'dashed' }}>
          <Empty>
            This page is closed — a diary a family has already read cannot be rewritten. Jump to
            today to add anything new.
          </Empty>
        </Page>
      )}

      <SectionTitle title={page ? `${page.className} · ${page.entries.length} entries` : 'Entries'} />

      {page === null && !error && (
        <Page>
          <Empty>Opening the diary…</Empty>
        </Page>
      )}
      {page?.entries.length === 0 && (
        <Page>
          <Empty>
            {isToday ? 'Nothing written yet today.' : 'Nothing was written on this day.'}
          </Empty>
        </Page>
      )}

      {page && page.entries.length > 0 && (
        <Page>
          {page.entries.map((e, i) => (
            <DiaryItem key={e.id} entry={e} index={i} first={i === 0}>
              {e.editable && (
                <Pressable
                  testID={`diary-remove-${e.id}`}
                  onPress={() => remove(e)}
                  style={{ alignSelf: 'flex-start', marginTop: 7 }}
                >
                  <Text style={{ color: tokens.color.red, fontSize: 12, fontWeight: '700' }}>
                    Strike out
                  </Text>
                </Pressable>
              )}
            </DiaryItem>
          ))}
        </Page>
      )}
    </Screen>
  );
}
