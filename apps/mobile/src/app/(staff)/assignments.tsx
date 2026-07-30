import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Assignment, AssignmentList, MyClassSection, Subject } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { shiftISO, todayISO } from '@/lib/attendance';
import { Card, Screen, SectionTitle, Toast } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';
import type { ColorPalette } from '@/theme/tokens';

function chipStyle(tokens: { color: ColorPalette }, on: boolean) {
  return {
    borderWidth: 1.5,
    borderColor: on ? tokens.color.indigo : tokens.color.line,
    backgroundColor: on ? tokens.color.indigo50 : tokens.color.surface,
    borderRadius: 11,
    paddingVertical: 9,
    paddingHorizontal: 13,
  };
}

/** `Assignment.dueDate` (`@db.Date`, `YYYY-MM-DD`) formatted for display — a plain calendar date, no time component. */
function formatDueDate(dueDate: string): string {
  const [y, m, d] = dueDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Assignments() {
  const tokens = useTokens();
  const inputStyle = {
    borderWidth: 1,
    borderColor: tokens.color.line,
    borderRadius: 11,
    padding: 11,
    fontSize: 13.5,
    color: tokens.color.ink,
  };
  const labelStyle = { fontSize: 11.5, fontWeight: '700' as const, color: tokens.color.sub };

  const [classes, setClasses] = useState<MyClassSection[] | null>(null);
  const [classesError, setClassesError] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [subjectsError, setSubjectsError] = useState<string | null>(null);
  const [classSectionId, setClassSectionId] = useState('');

  const [list, setList] = useState<AssignmentList | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);

  const [subjectId, setSubjectId] = useState('');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [dueDate, setDueDate] = useState(todayISO());
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setClassesError(null);
      api
        .request<MyClassSection[]>('/manage/attendance/my-classes')
        .then((data) => {
          if (!cancelled) setClasses(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setClassesError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setSubjectsError(null);
      api
        .request<Subject[]>('/manage/subjects')
        .then((data) => {
          if (!cancelled) setSubjects(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setSubjectsError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const fetchList = useCallback((id: string) => {
    if (!id) {
      setList(null);
      return;
    }
    setListLoading(true);
    setListError(null);
    api
      .request<AssignmentList>(`/manage/assignments?classSectionId=${encodeURIComponent(id)}`)
      .then((data) => setList(data))
      .catch((e: unknown) => setListError(e instanceof ApiError ? e.message : 'Something went wrong.'))
      .finally(() => setListLoading(false));
  }, []);

  // Plain effect, not useFocusEffect — this must re-run whenever the
  // SELECTED CLASS changes (a chip tap), not just on screen focus. Mirrors
  // `(staff)/tests.tsx`'s `fetchExams` effect exactly.
  useEffect(() => {
    fetchList(classSectionId);
  }, [classSectionId, fetchList]);

  const selectClass = (id: string) => {
    setClassSectionId(id);
    setPosted(false);
    setPostError(null);
  };

  const canPost = !!classSectionId && !!subjectId && title.trim().length > 0 && instructions.trim().length > 0 && !!dueDate && !posting;

  const post = async () => {
    if (!canPost) return;
    setPosting(true);
    setPostError(null);
    setPosted(false);
    try {
      // Mobile v1 has no expo-document-picker/expo-image-picker in this
      // app — attachments can only be added from the web portal (see the
      // note in the "Post an assignment" card below). `attachments` is
      // simply omitted, matching CreateAssignmentDto's `@IsOptional`.
      await api.request<Assignment>('/manage/assignments', {
        method: 'POST',
        body: { classSectionId, subjectId, title: title.trim(), instructions: instructions.trim(), dueDate },
      });
      setSubjectId('');
      setTitle('');
      setInstructions('');
      setDueDate(todayISO());
      setPosted(true);
      fetchList(classSectionId);
    } catch (e) {
      setPostError(e instanceof ApiError ? e.message : 'Could not post — try again.');
    } finally {
      setPosting(false);
    }
  };

  const subjectLabel = (id: string) => {
    const s = (subjects ?? []).find((x) => x.id === id);
    return s ? `${s.code} — ${s.name}` : '—';
  };

  // A TEACHER may only post/view assignments for sections they own —
  // AssignmentsService rejects `covering: true` sections with a 403
  // CLASS_NOT_OWNED (mirrors the web's `ownedClasses`, apps/web/app/teacher/
  // assignments/page.tsx). Filtering here means the picker never offers a
  // class the server will refuse.
  const ownedClasses = (classes ?? []).filter((c) => !c.covering);

  const upcoming = list?.upcoming ?? [];
  const past = list?.past ?? [];

  // A ref (not just `deletingId`) guards the actual network call — two
  // synchronous `onPress` invocations both read state as whatever it was
  // BEFORE either update flushes; the ref is read-and-set synchronously, so
  // only the first wins. Mirrors `deletingRef` in `(staff)/post.tsx`.
  const deletingRef = useRef<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function doDelete(id: string) {
    if (deletingRef.current) return;
    deletingRef.current = id;
    setDeletingId(id);
    setDeleteError(null);
    try {
      await api.request(`/manage/assignments/${id}`, { method: 'DELETE' });
      fetchList(classSectionId);
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : 'Could not delete — try again.');
    } finally {
      deletingRef.current = null;
      setDeletingId(null);
    }
  }

  function confirmDelete(a: Assignment) {
    if (deletingRef.current) return;
    Alert.alert('Delete this assignment?', `"${a.title}" will be removed for the class.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes, delete', style: 'destructive', onPress: () => void doDelete(a.id) },
    ]);
  }

  const renderRow = (a: Assignment) => (
    <View
      key={a.id}
      testID={`assignment-${a.id}`}
      style={{ paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: tokens.color.line }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={{ fontWeight: '600', fontSize: 13, color: tokens.color.ink }}>{a.title}</Text>
          <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>
            {subjectLabel(a.subjectId)} · Due {formatDueDate(a.dueDate)} · {a.seenCount} seen
          </Text>
        </View>
        <Pressable testID={`delete-${a.id}`} onPress={() => confirmDelete(a)} disabled={deletingId === a.id}>
          <Text style={{ color: tokens.color.red, fontWeight: '700', fontSize: 12 }}>
            {deletingId === a.id ? 'Deleting…' : 'Delete'}
          </Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <Screen>
      <SectionTitle title="Assignments" />
      <Text style={{ fontSize: 11, color: tokens.color.sub, marginHorizontal: 4, marginTop: -6 }}>
        Set homework for a class and see who has opened it.
      </Text>

      {classesError && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{classesError}</Text>
        </Card>
      )}
      {classes === null && !classesError && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading your classes…</Text>
        </Card>
      )}
      {classes && ownedClasses.length === 0 && !classesError && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>You have no classes assigned yet.</Text>
        </Card>
      )}

      {ownedClasses.length > 0 && (
        <Card>
          <Text style={{ ...labelStyle, marginBottom: 8 }}>Class</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {ownedClasses.map((c) => {
              const on = classSectionId === c.classSectionId;
              return (
                <Pressable
                  key={c.classSectionId}
                  testID={`class-${c.classSectionId}`}
                  onPress={() => selectClass(c.classSectionId)}
                  style={chipStyle(tokens, on)}
                >
                  <Text style={{ fontSize: 12.5, fontWeight: '700', color: on ? tokens.color.indigo : tokens.color.sub }}>
                    {on ? `✓ ${c.name}` : c.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      )}

      {classSectionId && (
        <Card style={{ gap: 10 }}>
          <View>
            <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>Post an assignment</Text>
            <Text style={{ fontSize: 11, color: tokens.color.sub, marginTop: 2 }}>
              Attach files from the web portal — this app can only post plain-text assignments for now.
            </Text>
          </View>

          {subjectsError && <Text style={{ color: tokens.color.red, fontSize: 12.5 }}>{subjectsError}</Text>}
          <View>
            <Text style={labelStyle}>Subject</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 6 }}>
              {(subjects ?? []).map((s) => {
                const on = subjectId === s.id;
                return (
                  <Pressable key={s.id} testID={`subject-${s.id}`} onPress={() => setSubjectId(s.id)} style={chipStyle(tokens, on)}>
                    <Text style={{ fontSize: 12.5, fontWeight: '700', color: on ? tokens.color.indigo : tokens.color.sub }}>
                      {on ? `✓ ${s.code}` : s.code}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View>
            <Text style={labelStyle}>Title</Text>
            <TextInput
              testID="assign-title"
              value={title}
              onChangeText={setTitle}
              placeholder="Worksheet 3"
              placeholderTextColor={tokens.color.sub}
              style={[inputStyle, { marginTop: 6 }]}
            />
          </View>

          <View>
            <Text style={labelStyle}>Instructions</Text>
            <TextInput
              testID="assign-instructions"
              value={instructions}
              onChangeText={setInstructions}
              multiline
              placeholder="Complete questions 1-10 and show your working."
              placeholderTextColor={tokens.color.sub}
              style={[inputStyle, { marginTop: 6, minHeight: 74, textAlignVertical: 'top' }]}
            />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={labelStyle}>Due date</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable testID="assign-due-prev" onPress={() => setDueDate((d) => shiftISO(d, -1))}>
                <Text style={{ color: tokens.color.indigo, fontWeight: '700' }}>‹</Text>
              </Pressable>
              <Text testID="assign-due-value" style={{ fontSize: 12.5, color: tokens.color.ink, minWidth: 84, textAlign: 'center' }}>
                {dueDate}
              </Text>
              <Pressable testID="assign-due-next" onPress={() => setDueDate((d) => shiftISO(d, 1))}>
                <Text style={{ color: tokens.color.indigo, fontWeight: '700' }}>›</Text>
              </Pressable>
            </View>
          </View>

          {postError && (
            <Text testID="post-error" style={{ color: tokens.color.red, fontSize: 12.5 }}>
              {postError}
            </Text>
          )}

          <Pressable
            testID="assign-submit"
            disabled={!canPost}
            onPress={() => void post()}
            style={{
              backgroundColor: tokens.color.indigo,
              borderRadius: 13,
              padding: 12,
              alignSelf: 'flex-start',
              paddingHorizontal: 18,
              opacity: canPost ? 1 : 0.6,
            }}
          >
            <Text style={{ color: tokens.color.onBrand, fontWeight: '700', fontSize: 13 }}>
              {posting ? 'Posting…' : 'Post assignment'}
            </Text>
          </Pressable>

          {posted && <Toast kind="success" testID="post-success" message="Assignment posted" />}
        </Card>
      )}

      {classSectionId && (
        <Card>
          <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>Posted assignments</Text>
          {listLoading && <Text style={{ color: tokens.color.sub, marginTop: 6 }}>Loading assignments…</Text>}
          {listError && (
            <Text testID="list-error" style={{ color: tokens.color.red, marginTop: 6 }}>
              {listError}
            </Text>
          )}
          {deleteError && (
            <Text testID="delete-error" style={{ color: tokens.color.red, marginTop: 6 }}>
              {deleteError}
            </Text>
          )}
          {!listLoading && !listError && upcoming.length === 0 && past.length === 0 && (
            <Text style={{ color: tokens.color.sub, marginTop: 6 }}>No assignments for this class yet.</Text>
          )}
          {upcoming.length > 0 && (
            <View style={{ marginTop: 10 }}>
              <Text style={labelStyle}>Upcoming</Text>
              {upcoming.map((a) => renderRow(a))}
            </View>
          )}
          {past.length > 0 && (
            <View style={{ marginTop: 10 }}>
              <Text style={labelStyle}>Past</Text>
              {past.map((a) => renderRow(a))}
            </View>
          )}
        </Card>
      )}
    </Screen>
  );
}
