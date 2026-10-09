import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Linking, Pressable, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect } from 'expo-router';
import type { Assignment, AssignmentAttachment, AssignmentList, MyClassSection, Subject } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { todayISO } from '@/lib/attendance';
import { Card, Empty, Screen, SectionTitle, Toast } from '@/components/ui';
import { Button } from '@/components/Button';
import { DateField, Field, fieldInputStyle, SelectField } from '@/components/Field';
import { addDays, classOptions, onlyOwnSubject, subjectOptions, useMySubjectNames } from '@/lib/subject-options';
import { LoadingRows } from '@/components/Loading';
import { Icon } from '@/components/icons';
import { useTokens } from '@/theme/theme-context';
import { DUR, inkWidth, useGesture } from '@/theme/motion';
import { fmtDate } from '@/lib/dates';

/** Same caps as the web teacher page and the API (Vercel's ~4.5 MB body). */
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENT_MB = 4;
const MAX_ATTACHMENTS = 5;

/**
 * THE INK LINE (`.seenbar`) — how far a posted assignment has actually
 * reached. It fills once, on the render the row first appears in, because the
 * number it draws is a fact fetched from the server, not something happening
 * live; re-running it on every refetch would imply students had just opened
 * it. Drawn ONLY when the class roster size is known — a bar with a guessed
 * denominator is a picture of nothing.
 */
function SeenBar({ seen, of }: { seen: number; of: number }) {
  const tokens = useTokens();
  const percent = of > 0 ? Math.min(100, Math.round((seen / of) * 100)) : 0;
  const fill = useGesture(true, DUR.ink, { native: false });
  return (
    <View style={{ marginTop: 6, gap: 3 }}>
      <View
        style={{ height: 5, borderRadius: 999, backgroundColor: tokens.color.line, overflow: 'hidden' }}
      >
        <Animated.View
          style={{
            height: '100%',
            borderRadius: 999,
            backgroundColor: tokens.color.green,
            width: inkWidth(fill, percent),
          }}
        />
      </View>
      <Text style={{ fontVariant: ['tabular-nums'], fontSize: 13, color: tokens.color.sub }}>
        {`opened by ${seen} of ${of}`}
      </Text>
    </View>
  );
}

/** `Assignment.dueDate` (`@db.Date`, `YYYY-MM-DD`) formatted for display — a plain calendar date, no time component. */
function formatDueDate(dueDate: string): string {
  return fmtDate(dueDate);
}

export default function Assignments() {
  const tokens = useTokens();
  // The same 13/600 label `Field` draws, for the groups that are not a text box.
  const labelStyle = { fontSize: 13, lineHeight: 18, fontWeight: '600' as const, color: tokens.color.ink2 };
  const [titleFocused, setTitleFocused] = useState(false);
  const [instructionsFocused, setInstructionsFocused] = useState(false);

  const [classes, setClasses] = useState<MyClassSection[] | null>(null);
  const [classesError, setClassesError] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [subjectsError, setSubjectsError] = useState<string | null>(null);
  const [classSectionId, setClassSectionId] = useState('');

  const [list, setList] = useState<AssignmentList | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);

  const [subjectId, setSubjectId] = useState('');
  const mySubjects = useMySubjectNames();
  const [title, setTitle] = useState('');
  // The keyboard's Next moves from the one-line title to the details box.
  const instructionsRef = useRef<TextInput>(null);
  const [instructions, setInstructions] = useState('');
  const [dueDate, setDueDate] = useState(todayISO());
  // Attachments (second edition): uploaded one at a time to
  // /manage/assignments/upload, which answers { url, name, kind }; the create
  // call then carries the list — the exact flow the web teacher page uses.
  const [attachments, setAttachments] = useState<AssignmentAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
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

  /**
   * Pick a PDF or an image and upload it. The same gates as the web page,
   * BEFORE any network call: five files, four megabytes, PDF or image — an
   * oversized or wrong file never leaves the phone.
   */
  const pickAttachment = async () => {
    setAttachError(null);
    if (attachments.length >= MAX_ATTACHMENTS) {
      setAttachError(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], multiple: false, copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const f = res.assets[0];
    if (f.size && f.size > MAX_ATTACHMENT_BYTES) {
      setAttachError(`"${f.name}" is too large — attachments are limited to ${MAX_ATTACHMENT_MB} MB.`);
      return;
    }
    const mime = f.mimeType ?? '';
    if (!(mime === 'application/pdf' || mime.startsWith('image/'))) {
      setAttachError(`"${f.name}" isn’t a PDF or image — only PDF or image files can be attached.`);
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', { uri: f.uri, name: f.name, type: mime } as unknown as Blob);
      const uploaded = await api.upload<AssignmentAttachment>('/manage/assignments/upload', form);
      setAttachments((prev) => [...prev, uploaded]);
    } catch (e) {
      setAttachError(e instanceof ApiError ? e.message : 'Could not upload — try again.');
    } finally {
      setUploading(false);
    }
  };

  const canPost = !!classSectionId && !!subjectId && title.trim().length > 0 && instructions.trim().length > 0 && !!dueDate && !posting;

  const post = async () => {
    if (!canPost) return;
    setPosting(true);
    setPostError(null);
    setPosted(false);
    try {
      // `attachments` rides only when there are any — CreateAssignmentDto
      // marks it @IsOptional, and an empty array says nothing a missing key
      // does not.
      await api.request<Assignment>('/manage/assignments', {
        method: 'POST',
        body: {
          classSectionId, subjectId, title: title.trim(), instructions: instructions.trim(), dueDate,
          ...(attachments.length ? { attachments } : {}),
        },
      });
      setSubjectId(onlyOwnSubject(subjects ?? [], mySubjects) ?? '');
      setTitle('');
      setInstructions('');
      setDueDate(todayISO());
      setAttachments([]);
      setAttachError(null);
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
    return s ? s.name : '—';
  };

  // A TEACHER may only post/view assignments for sections they own —
  // AssignmentsService rejects `covering: true` sections with a 403
  // CLASS_NOT_OWNED (mirrors the web's `ownedClasses`, apps/web/app/teacher/
  // assignments/page.tsx). Filtering here means the picker never offers a
  // class the server will refuse.
  const ownedClasses = (classes ?? []).filter((c) => !c.covering);

  // One class? It is the class — no question to answer.
  useEffect(() => {
    if (!classSectionId && ownedClasses.length === 1) selectClass(ownedClasses[0].classSectionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes]);
  // One subject of their own? Pre-pick it; they can still change it.
  useEffect(() => {
    if (!subjectId && subjects) {
      const only = onlyOwnSubject(subjects, mySubjects);
      if (only) setSubjectId(only);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects, mySubjects]);

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

  // The roster size of the class currently on screen — the only honest
  // denominator for the seen bar below. `undefined` until the class list has
  // loaded, in which case no bar is drawn at all.
  const rosterSize = ownedClasses.find((c) => c.classSectionId === classSectionId)?.studentCount;

  const renderRow = (a: Assignment) => (
    <View
      key={a.id}
      testID={`assignment-${a.id}`}
      style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: tokens.color.line }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={{ fontWeight: '600', fontSize: 16, color: tokens.color.ink }}>
            {a.title}
          </Text>
          <Text style={{ fontSize: 13, color: tokens.color.sub, marginTop: 2 }}>
            {subjectLabel(a.subjectId)} · Due {formatDueDate(a.dueDate)} · {a.seenCount} seen
          </Text>
          {a.attachments?.length ? (
            <View style={{ marginTop: 5, gap: 4 }}>
              {a.attachments.map((att) => (
                <Pressable key={att.url} testID={`attachment-${att.name}`} accessibilityRole="link" hitSlop={4} onPress={() => void Linking.openURL(att.url)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40 }}>
                  <Icon name={att.kind === 'pdf' ? 'report' : 'diary'} size={16} color={tokens.color.indigo} />
                  <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: tokens.color.indigo, flexShrink: 1 }}>{att.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
        <Button
          testID={`delete-${a.id}`}
          variant="danger"
          size="sm"
          label={deletingId === a.id ? 'Deleting…' : 'Delete'}
          busy={deletingId === a.id}
          disabled={deletingId === a.id}
          onPress={() => confirmDelete(a)}
        />
      </View>
      {rosterSize !== undefined && rosterSize > 0 && <SeenBar seen={a.seenCount} of={rosterSize} />}
    </View>
  );

  return (
    <Screen>
      <SectionTitle title="Assignments" />
      <Text style={{ fontSize: 14, color: tokens.color.sub, marginHorizontal: 4, marginTop: -6 }}>
        Set homework for a class and see who has opened it.
      </Text>

      {classesError && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{classesError}</Text>
        </Card>
      )}
      {classes === null && !classesError && (
        <LoadingRows label="Loading your classes…" rows={5} />
      )}
      {classes && ownedClasses.length === 0 && !classesError && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>You have no classes assigned yet.</Text>
        </Card>
      )}

      {ownedClasses.length > 0 && (
        <Card>
          {/* A dropdown, not chips (user, 9 Oct 2026): the class with its roll
              size, auto-picked when the teacher has only one. */}
          <SelectField
            label="Class"
            testID="assign-class"
            optionTestID={(id) => `class-${id}`}
            placeholder="Choose a class"
            value={classSectionId || null}
            options={classOptions(ownedClasses)}
            onChange={selectClass}
          />
        </Card>
      )}

      {/* Choose-first (empty kind "choose", v2 2026-10-08): until a class is
          picked the form is hidden, and the page said so with 80% blank. */}
      {ownedClasses.length > 0 && !classSectionId && (
        <Empty kind="choose" icon="assignments" title="Choose a class above">
          The form opens for that class — you can post homework to one class at a time.
        </Empty>
      )}

      {classSectionId && (
        <Card style={{ gap: 10 }}>
          <View>
            <Text style={{ fontSize: 17, fontWeight: '700', color: tokens.color.ink }}>Post an assignment</Text>
            <Text style={{ fontSize: 13, color: tokens.color.sub, marginTop: 2 }}>
              A title, the instructions, a due date — and up to five PDFs or images.
            </Text>
          </View>

          {subjectsError && <Text style={{ color: tokens.color.red, fontSize: 13 }}>{subjectsError}</Text>}
          <SelectField
            label="Subject"
            testID="assign-subject"
            optionTestID={(id) => `subject-${id}`}
            placeholder="Choose a subject"
            value={subjectId || null}
            options={subjectOptions(subjects ?? [], mySubjects)}
            onChange={setSubjectId}
          />

          <Field label="Title">
            <TextInput
              testID="assign-title"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => instructionsRef.current?.focus()}
              value={title}
              onChangeText={setTitle}
              placeholder="Worksheet 3"
              placeholderTextColor={tokens.color.placeholder}
              onFocus={() => setTitleFocused(true)}
              onBlur={() => setTitleFocused(false)}
              style={fieldInputStyle(tokens, { focused: titleFocused })}
            />
          </Field>

          <Field label="Instructions">
            <TextInput
              testID="assign-instructions"
              ref={instructionsRef}
              value={instructions}
              onChangeText={setInstructions}
              multiline
              placeholder="Complete questions 1-10 and show your working."
              placeholderTextColor={tokens.color.placeholder}
              onFocus={() => setInstructionsFocused(true)}
              onBlur={() => setInstructionsFocused(false)}
              style={fieldInputStyle(tokens, { focused: instructionsFocused, multiline: true })}
            />
          </Field>

          {/* A calendar with the weekday, not a ‹ 2026-10-09 › stepper. */}
          <DateField
            label="Due date"
            testID="assign-due"
            value={dueDate}
            minDate={todayISO()}
            onChange={setDueDate}
            quick={[
              { label: 'Tomorrow', iso: addDays(todayISO(), 1) },
              { label: 'In 3 days', iso: addDays(todayISO(), 3) },
              { label: 'In a week', iso: addDays(todayISO(), 7) },
            ]}
          />

          <View style={{ gap: 6 }}>
            <Text style={labelStyle}>Attachments</Text>
            {attachments.length > 0 && (
              <View style={{ gap: 4 }}>
                {attachments.map((att) => (
                  <View key={att.url} testID={`attached-${att.name}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Icon name={att.kind === 'pdf' ? 'report' : 'diary'} size={16} color={tokens.color.indigo} />
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: tokens.color.ink }}>{att.name}</Text>
                    <Button
                      testID={`attached-remove-${att.name}`}
                      variant="text"
                      size="sm"
                      label="Remove"
                      accessibilityLabel={`Remove ${att.name}`}
                      onPress={() => setAttachments((prev) => prev.filter((x) => x.url !== att.url))}
                    />
                  </View>
                ))}
              </View>
            )}
            <Button
              testID="assign-attach"
              variant="outlined"
              icon="diary"
              block
              disabled={uploading || attachments.length >= MAX_ATTACHMENTS}
              busy={uploading}
              label={uploading ? 'Uploading…' : attachments.length ? `Add another (${attachments.length} of ${MAX_ATTACHMENTS})` : 'Attach a PDF or image — optional'}
              onPress={() => void pickAttachment()}
            />
            {attachError && <Text testID="attach-error" style={{ color: tokens.color.red, fontSize: 13, marginTop: 4 }}>{attachError}</Text>}
          </View>

          {postError && (
            <Text testID="post-error" style={{ color: tokens.color.red, fontSize: 13 }}>
              {postError}
            </Text>
          )}

          <Button
            testID="assign-submit"
            block
            disabled={!canPost}
            busy={posting}
            label={posting ? 'Posting…' : 'Post assignment'}
            onPress={() => void post()}
          />

          {posted && <Toast kind="success" testID="post-success" message="Assignment posted" />}
        </Card>
      )}

      {classSectionId && (
        <Card>
          <Text style={{ fontSize: 17, fontWeight: '700', color: tokens.color.ink }}>Posted assignments</Text>
          {listLoading && <LoadingRows label="Loading assignments…" rows={3} bare />}
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
