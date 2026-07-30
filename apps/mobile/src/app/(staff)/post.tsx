import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { AnnouncementMine } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import type { MyClassSection } from '@/lib/attendance';
import { ClassChips } from '@/components/ClassChips';
import { Card, Screen, SectionTitle, Toast } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';

/** Mirrors `formatDateTime` in `(staff)/requests.tsx` — a real timestamp, read in the device's own local time. */
function formatPostedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function Post() {
  const tokens = useTokens();
  const inputStyle = {
    borderWidth: 1,
    borderColor: tokens.color.line,
    borderRadius: 11,
    padding: 11,
    fontSize: 13.5,
    color: tokens.color.ink,
  };
  const [classes, setClasses] = useState<MyClassSection[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  // ── Your recent posts — GET /manage/announcements/mine ──────────────────
  const [mine, setMine] = useState<AnnouncementMine[] | null>(null);
  const [mineError, setMineError] = useState<string | null>(null);

  const fetchMine = useCallback(() => {
    setMineError(null);
    return api
      .request<AnnouncementMine[]>('/manage/announcements/mine')
      .then((data) => setMine(data))
      .catch((e: unknown) => setMineError(e instanceof ApiError ? e.message : 'Something went wrong.'));
  }, []);

  // Refetch on focus — a teacher may have picked up/lost a class assignment
  // since the last visit, and may have edited/deleted a post elsewhere.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoadError(null);
      api
        .request<MyClassSection[]>('/manage/attendance/my-classes')
        .then((data) => {
          if (!cancelled) setClasses(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setLoadError(e instanceof ApiError ? e.message : 'Something went wrong.');
        });
      void fetchMine();
      return () => {
        cancelled = true;
      };
    }, [fetchMine]),
  );

  const n = selected.length;
  const canSubmit = n > 0 && title.trim().length > 0 && body.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setSubmitError(null);
    setPosted(false);
    try {
      await api.request('/manage/announcements', {
        method: 'POST',
        body: { title: title.trim(), body: body.trim(), classSectionIds: selected },
      });
      setTitle('');
      setBody('');
      setSelected([]);
      setPosted(true);
      void fetchMine();
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : 'Could not post — try again.');
    } finally {
      setBusy(false);
    }
  };

  // ── Edit / delete own posts ───────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState(false);

  function startEdit(a: AnnouncementMine) {
    setEditingId(a.id);
    setEditTitle(a.title);
    setEditBody(a.body);
    setEditError(null);
    setEditSuccess(false);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  const trimmedEditTitle = editTitle.trim();
  const trimmedEditBody = editBody.trim();
  const canSaveEdit = trimmedEditTitle.length > 0 && trimmedEditBody.length > 0 && !editBusy;

  async function saveEdit() {
    if (!editingId || !canSaveEdit) return;
    setEditBusy(true);
    setEditError(null);
    setEditSuccess(false);
    try {
      await api.request(`/manage/announcements/${editingId}`, {
        method: 'PATCH',
        body: { title: trimmedEditTitle, body: trimmedEditBody },
      });
      setEditingId(null);
      setEditSuccess(true);
      void fetchMine();
    } catch (e) {
      setEditError(e instanceof ApiError ? e.message : 'Could not save — try again.');
    } finally {
      setEditBusy(false);
    }
  }

  // A ref (not just `deletingId`) guards the actual network call — two
  // synchronous `onPress` invocations both read state as whatever it was
  // BEFORE either update flushes; the ref is read-and-set synchronously, so
  // only the first wins. Mirrors `cancellingRef` in `(staff)/requests.tsx`.
  const deletingRef = useRef<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  async function doDelete(id: string) {
    if (deletingRef.current) return;
    deletingRef.current = id;
    setDeletingId(id);
    setDeleteError(null);
    setDeleteSuccess(false);
    try {
      await api.request(`/manage/announcements/${id}`, { method: 'DELETE' });
      setDeleteSuccess(true);
      void fetchMine();
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : 'Could not delete — try again.');
    } finally {
      deletingRef.current = null;
      setDeletingId(null);
    }
  }

  function confirmDelete(a: AnnouncementMine) {
    if (deletingRef.current) return;
    Alert.alert('Delete this announcement?', `"${a.title}" will be removed for everyone it was sent to.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes, delete', style: 'destructive', onPress: () => void doDelete(a.id) },
    ]);
  }

  return (
    <Screen>
      <SectionTitle title="Announcements" />
      {loadError && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{loadError}</Text>
        </Card>
      )}
      {classes === null && !loadError && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading your classes…</Text>
        </Card>
      )}
      {classes?.length === 0 && !loadError && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>You have no classes assigned yet.</Text>
        </Card>
      )}
      {classes && classes.length > 0 && (
        <Card>
          <Text style={{ fontSize: 11.5, fontWeight: '700', color: tokens.color.sub, marginBottom: 8 }}>
            Send to — tap to select multiple
          </Text>
          <ClassChips
            classes={classes.map((c) => ({ classSectionId: c.classSectionId, name: c.name }))}
            selected={selected}
            onChange={setSelected}
          />
        </Card>
      )}
      {classes && classes.length > 0 && (
        <Card style={{ gap: 10 }}>
          <View>
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: tokens.color.sub, marginBottom: 5 }}>
              Title
            </Text>
            <TextInput
              testID="post-title"
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Chapter 4 comprehension"
              placeholderTextColor={tokens.color.sub}
              style={inputStyle}
            />
          </View>
          <View>
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: tokens.color.sub, marginBottom: 5 }}>
              Details
            </Text>
            <TextInput
              testID="post-body"
              value={body}
              onChangeText={setBody}
              placeholder="Add instructions, due date…"
              placeholderTextColor={tokens.color.sub}
              multiline
              style={[inputStyle, { minHeight: 74, textAlignVertical: 'top' }]}
            />
          </View>
        </Card>
      )}
      {submitError && (
        <Card>
          <Text style={{ color: tokens.color.red }}>{submitError}</Text>
        </Card>
      )}
      {posted && (
        <Card>
          <Text style={{ color: tokens.color.green, fontWeight: '700' }}>Posted ✓</Text>
        </Card>
      )}
      {classes && classes.length > 0 && (
        <Pressable
          testID="post-submit"
          onPress={submit}
          disabled={!canSubmit}
          style={{
            backgroundColor: tokens.color.indigo,
            borderRadius: 14,
            padding: 15,
            opacity: canSubmit ? 1 : 0.6,
          }}
        >
          <Text style={{ color: tokens.color.onBrand, fontWeight: '700', textAlign: 'center' }}>
            {busy ? 'Posting…' : `Post to ${n} class${n === 1 ? '' : 'es'}`}
          </Text>
        </Pressable>
      )}

      <SectionTitle title="Your recent posts" />

      {editError && (
        <Card>
          <Text testID="edit-error" style={{ color: tokens.color.red }}>
            {editError}
          </Text>
        </Card>
      )}
      {editSuccess && <Toast kind="success" testID="edit-success" message="Announcement updated" />}
      {deleteError && (
        <Card>
          <Text testID="delete-error" style={{ color: tokens.color.red }}>
            {deleteError}
          </Text>
        </Card>
      )}
      {deleteSuccess && <Toast kind="success" testID="delete-success" message="Announcement deleted" />}

      {mineError && (
        <Card>
          <Text testID="mine-error" style={{ color: tokens.color.red }}>
            {mineError}
          </Text>
        </Card>
      )}
      {mine === null && !mineError && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>Loading your posts…</Text>
        </Card>
      )}
      {mine?.length === 0 && !mineError && (
        <Card>
          <Text style={{ color: tokens.color.sub }}>You haven&apos;t posted anything yet.</Text>
        </Card>
      )}
      {mine?.map((a) =>
        editingId === a.id ? (
          <Card key={a.id} style={{ gap: 10 }} testID={`mine-row-${a.id}`}>
            <TextInput
              testID="edit-title"
              value={editTitle}
              onChangeText={setEditTitle}
              placeholderTextColor={tokens.color.sub}
              style={inputStyle}
            />
            <TextInput
              testID="edit-body"
              value={editBody}
              onChangeText={setEditBody}
              placeholderTextColor={tokens.color.sub}
              multiline
              style={[inputStyle, { minHeight: 74, textAlignVertical: 'top' }]}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 14 }}>
              <Pressable testID="edit-cancel" onPress={cancelEdit} disabled={editBusy}>
                <Text style={{ color: tokens.color.sub, fontWeight: '700', fontSize: 13 }}>Cancel</Text>
              </Pressable>
              <Pressable testID="edit-save" onPress={() => void saveEdit()} disabled={!canSaveEdit}>
                <Text
                  style={{
                    color: tokens.color.indigo,
                    fontWeight: '700',
                    fontSize: 13,
                    opacity: canSaveEdit ? 1 : 0.5,
                  }}
                >
                  {editBusy ? 'Saving…' : 'Save'}
                </Text>
              </Pressable>
            </View>
          </Card>
        ) : (
          <Card key={a.id} testID={`mine-row-${a.id}`}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: tokens.color.indigo }}>
                  {a.className ?? 'Whole school'}
                </Text>
                <Text style={{ fontWeight: '700', fontSize: 14, color: tokens.color.ink, marginTop: 4 }}>
                  {a.title}
                </Text>
                <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>{a.body}</Text>
                <Text style={{ fontSize: 11, color: tokens.color.sub, marginTop: 4 }}>
                  {formatPostedAt(a.createdAt)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 8 }}>
                <Pressable
                  testID={`edit-${a.id}`}
                  onPress={() => startEdit(a)}
                  disabled={deletingId === a.id}
                >
                  <Text style={{ color: tokens.color.indigo, fontWeight: '700', fontSize: 12 }}>Edit</Text>
                </Pressable>
                <Pressable
                  testID={`delete-${a.id}`}
                  onPress={() => confirmDelete(a)}
                  disabled={deletingId === a.id}
                >
                  <Text style={{ color: tokens.color.red, fontWeight: '700', fontSize: 12 }}>
                    {deletingId === a.id ? 'Deleting…' : 'Delete'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </Card>
        ),
      )}
    </Screen>
  );
}
