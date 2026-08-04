import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Animated, Pressable, Text, TextInput, View } from 'react-native';
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

/** The server's cap, mirrored from the web composer (apps/web/app/teacher/diary). */
const MAX_BODY = 2000;

type Kind = 'ITEM' | 'REMARK';

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
  // Capped stagger: `index * 80` meant the twentieth line of a busy day did
  // not arrive until 1.6s after the page did.
  const pin = useGesture(true, DUR.pin, { delay: Math.min(index, 6) * 80 });
  const red = entry.kind === 'REMARK';

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

        {/* WHO it is for, by NAME. The repaint compressed the recipients to
            first names only, on one line, which on a class with two Aaravs
            stops identifying anybody — and a remark is precisely the entry
            where the teacher has to be certain which child it landed on. */}
        {entry.students.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
            {entry.students.map((s) => (
              <View
                key={s.studentId}
                style={{
                  backgroundColor: tokens.color.surfaceMuted,
                  borderRadius: tokens.radius.chip,
                  paddingVertical: 3,
                  paddingHorizontal: 8,
                }}
              >
                <Text style={{ color: tokens.color.sub, fontSize: 11, fontWeight: '600' }}>{s.name}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={{ color: tokens.color.sub, fontSize: 11, marginTop: 5 }}>
          {entry.authorName}
          {entry.students.length > 0 ? '' : ' · Whole class'}
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

      {/* Paged, not a strip. The repaint replaced these three buttons with a
          six-cell window ending at today, and hung `diary-prev`/`diary-next`
          on whichever CELL happened to be the day either side of the selected
          one — so pressing "previous" twice did nothing the second time, and
          a teacher could no longer walk back past six days at all. A relative
          shift with no window limit is the whole point of this control. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginHorizontal: 4,
        }}
      >
        <Pressable testID="diary-prev" onPress={() => setDate((d) => shiftISO(d, -1))} hitSlop={8}>
          <Text style={{ color: tokens.color.indigo, fontWeight: '700', fontSize: 13 }}>‹ Prev day</Text>
        </Pressable>
        {!isToday && (
          <Pressable testID="diary-today" onPress={() => setDate(today)} hitSlop={8}>
            <Text style={{ color: tokens.color.sub, fontWeight: '600', fontSize: 12 }}>Jump to today</Text>
          </Pressable>
        )}
        <Pressable
          testID="diary-next"
          onPress={() => setDate((d) => (d < today ? shiftISO(d, 1) : d))}
          hitSlop={8}
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
            // Matches the server's cap and the web composer's, so a long entry
            // stops in the box instead of being lost to a 400 after the send.
            maxLength={MAX_BODY}
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

      {/* Solid, not dashed: RN draws a dashed border on a view that also has a
          border radius as a solid one on iOS and as a broken outline on
          Android, so `borderStyle: 'dashed'` here bought nothing and risked a
          visibly different frame per platform. */}
      {!isToday && (
        <Page>
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
