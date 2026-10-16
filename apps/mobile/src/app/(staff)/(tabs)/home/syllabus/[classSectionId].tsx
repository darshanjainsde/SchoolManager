import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { SyllabusChapterRow, SyllabusLeaf, SyllabusStatus, SyllabusTrack } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { useReload } from '@/lib/query';
import { Card, Empty, ErrorState, Figure, ListScreen, Pill, SectionTitle, Toast } from '@/components/ui';
import { Button } from '@/components/Button';
import { SegmentedField, SelectField, TextField } from '@/components/Field';
import { LoadingRows } from '@/components/Loading';
import { Sheet } from '@/components/Sheet';
import { RingLegend, Rings } from '@/components/Rings';
import { PACE_LABEL, PACE_TONE, STATUS_LABEL, STATUS_OPTIONS, STATUS_TONE, gapLine, ringColors } from '@/lib/syllabus';
import { fmtDate } from '@/lib/dates';
import { useTokens } from '@/theme/theme-context';

/** A row of the list: a chapter heading, or a leaf (a sub-topic, or a chapter with none). */
type RowItem =
  | { kind: 'chapter'; ch: SyllabusChapterRow; index: number }
  | { kind: 'leaf'; leaf: SyllabusLeaf; sub: boolean; parent: SyllabusChapterRow; index: number };

function rowsOf(chapters: SyllabusChapterRow[]): RowItem[] {
  const out: RowItem[] = [];
  chapters.forEach((ch, index) => {
    if (ch.children.length === 0) out.push({ kind: 'leaf', leaf: ch, sub: false, parent: ch, index });
    else {
      out.push({ kind: 'chapter', ch, index });
      for (const c of ch.children) out.push({ kind: 'leaf', leaf: c, sub: true, parent: ch, index });
    }
  });
  return out;
}

/**
 * One track: the rings, then the chapters. Tap a topic for a bottom sheet
 * with the three status buttons, a note for the class, and "Reached here".
 * A substitute (today's cover) reads the same list and gets no sheet.
 */
export default function SyllabusTrackScreen() {
  const { classSectionId, subjectId } = useLocalSearchParams<{ classSectionId: string; subjectId: string }>();
  const tokens = useTokens();
  const colors = ringColors(tokens.color);
  const base = `/manage/syllabus/tracks/${encodeURIComponent(classSectionId ?? '')}/${encodeURIComponent(subjectId ?? '')}`;
  const [reloadKey, reload] = useReload();
  const [track, setTrack] = useState<SyllabusTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<RowItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      api
        .request<SyllabusTrack>(base)
        .then((t) => { if (!cancelled) setTrack(t); })
        .catch((e: unknown) => { if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.'); });
      return () => { cancelled = true; };
    }, [base, reloadKey]),
  );

  const rows = useMemo(() => (track ? rowsOf(track.chapters) : []), [track]);
  const s = track?.summary;

  const header = (
    <View style={{ gap: 12 }}>
      <SectionTitle title={s ? `${s.className} · ${s.subjectName}` : 'Syllabus'} />
      {error && <ErrorState error={error} onRetry={reload} testID="track-error" />}
      {track === null && !error && <LoadingRows label="Opening the track…" rows={5} />}
      {track && s && (
        <>
          <Card testID="track-hero">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Rings
                outer={{ pct: s.pct, color: colors.taught, label: 'Taught' }}
                inner={{ pct: s.expectedPct, color: colors.expected, label: 'Expected by today' }}
                size={96} stroke={11} centre={`${s.pct}%`}
              />
              <View style={{ flex: 1, gap: 8, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Pill tone={PACE_TONE[s.pace]}>{PACE_LABEL[s.pace]}</Pill>
                  <Text style={{ fontSize: 13, color: tokens.color.sub }}>{gapLine(s)}</Text>
                </View>
                <RingLegend
                  outer={{ pct: s.pct, color: colors.taught, label: 'Taught' }}
                  inner={{ pct: s.expectedPct, color: colors.expected, label: 'Expected by today' }}
                />
                {s.now && <Text style={{ fontSize: 13, color: tokens.color.ink }} numberOfLines={2}>{`Now: ${s.now.title}`}</Text>}
              </View>
            </View>
          </Card>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Figure label="Topics done" value={`${s.done} / ${s.leaves}`} />
            <Figure label="Expected" value={`${s.expectedPct}%`} />
            <Figure label="Left" value={`${s.leaves - s.done}`} />
          </View>
          {!track.canEdit && (
            <Card testID="track-readonly">
              <Text style={{ fontSize: 13, color: tokens.color.sub }}>
                You are covering this class today, so you can read the syllabus but not mark it. The regular teacher&rsquo;s log stays theirs.
              </Text>
            </Card>
          )}
        </>
      )}
    </View>
  );

  // The empty state carries its own "Add the first chapter"; the footer button is for a list that exists.
  const footer = track?.canEdit && rows.length > 0 ? (
    <View style={{ paddingTop: 8 }}>
      <Button variant="tonal" label="Add a chapter" onPress={() => setAdding(true)} testID="track-add-chapter" block />
      <Text style={{ fontSize: 12.5, color: tokens.color.sub, marginTop: 8 }}>
        {s ? `Chapters are shared by every section of ${s.gradeName}, this year and next.` : ''}
      </Text>
    </View>
  ) : null;

  const empty = track && !error ? (
    <Empty kind="first" icon="syllabus" title="No chapters yet" testID="track-empty" action={track.canEdit ? { label: 'Add the first chapter', onPress: () => setAdding(true), testID: 'track-add-first' } : undefined}>
      Add the chapter list once, and every section of the class gets it.
    </Empty>
  ) : null;

  return (
    <>
      <ListScreen
        data={rows}
        keyExtractor={(r) => (r.kind === 'chapter' ? `c:${r.ch.id}` : `l:${r.leaf.id}`)}
        header={header}
        footer={footer}
        empty={empty}
        onRefresh={reload}
        testID="track-list"
        renderItem={(r) =>
          r.kind === 'chapter' ? (
            <View style={{ paddingTop: 10, paddingHorizontal: 4, gap: 2 }} testID={`track-ch-${r.ch.id}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: tokens.color.ink }}>{`${r.index + 1}. ${r.ch.title}`}</Text>
                <Pill tone={STATUS_TONE[r.ch.status]}>{STATUS_LABEL[r.ch.status]}</Pill>
              </View>
              <Text style={{ fontSize: 12.5, color: tokens.color.sub }}>
                {`${r.ch.children.filter((c) => c.status === 'DONE').length} of ${r.ch.children.length} sub-topics done`}
              </Text>
              {r.ch.note ? <Text style={{ fontSize: 13, color: tokens.color.ink2 }}>{`Note: ${r.ch.note}`}</Text> : null}
            </View>
          ) : (
            <Pressable
              testID={`track-leaf-${r.leaf.id}`}
              disabled={!track?.canEdit}
              onPress={() => setOpen(r)}
              accessibilityRole="button"
              accessibilityLabel={`${r.leaf.title}, ${STATUS_LABEL[r.leaf.status]}`}
              style={({ pressed }) => ({ marginLeft: r.sub ? 14 : 0, borderRadius: tokens.radius.card, opacity: pressed ? 0.8 : 1 })}
            >
              <Card style={{ gap: 6, minHeight: 64 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, fontSize: r.sub ? 14 : 15, fontWeight: '600', color: tokens.color.ink }}>
                    {r.sub ? r.leaf.title : `${r.index + 1}. ${r.leaf.title}`}
                  </Text>
                  <Pill tone={STATUS_TONE[r.leaf.status]}>{STATUS_LABEL[r.leaf.status]}</Pill>
                </View>
                {s?.now?.chapterId === r.leaf.id && <Text style={{ fontSize: 12.5, color: tokens.color.indigo, fontWeight: '600' }}>Where the class is now</Text>}
                {r.leaf.note ? <Text style={{ fontSize: 13, color: tokens.color.ink2 }}>{`Note: ${r.leaf.note}`}</Text> : null}
                {r.leaf.updatedAt ? (
                  <Text style={{ fontSize: 12, color: tokens.color.sub }}>{`${r.leaf.updatedBy ? `${r.leaf.updatedBy} · ` : ''}${fmtDate(r.leaf.updatedAt)}`}</Text>
                ) : null}
              </Card>
            </Pressable>
          )
        }
      />
      {open && open.kind === 'leaf' && track && (
        <MarkSheet
          leaf={open.leaf}
          base={base}
          onClose={() => setOpen(null)}
          onSaved={(t, msg) => { setTrack(t); setOpen(null); setToast(msg); }}
        />
      )}
      {adding && track && (
        <AddChapterSheet
          track={track}
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); setToast('Added for every section of the class.'); reload(); }}
        />
      )}
      {toast && <Toast kind="success" message={toast} testID="track-toast" />}
    </>
  );
}

function MarkSheet({ leaf, base, onClose, onSaved }: { leaf: SyllabusLeaf; base: string; onClose: () => void; onSaved: (t: SyllabusTrack, msg: string) => void }) {
  const tokens = useTokens();
  const [status, setStatus] = useState<SyllabusStatus>(leaf.status);
  const [note, setNote] = useState(leaf.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const changed = status !== leaf.status || note.trim() !== (leaf.note ?? '');

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body: { status?: SyllabusStatus; note?: string } = {};
      if (status !== leaf.status) body.status = status;
      if (note.trim() !== (leaf.note ?? '')) body.note = note.trim();
      const t = await api.request<SyllabusTrack>(`${base}/progress/${encodeURIComponent(leaf.id)}`, { method: 'PUT', body });
      onSaved(t, body.status ? `${leaf.title}: ${STATUS_LABEL[body.status]}` : 'Note saved.');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  const reach = async () => {
    setBusy(true);
    setErr(null);
    try {
      const t = await api.request<SyllabusTrack>(`${base}/reach/${encodeURIComponent(leaf.id)}`, { method: 'POST', body: {} });
      onSaved(t, 'Everything before it is done.');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title={leaf.title} subtitle={leaf.updatedAt ? `Last marked ${fmtDate(leaf.updatedAt)}` : 'Not marked yet'} testID="mark-sheet"
      footer={<Button label="Save" onPress={() => void save()} disabled={!changed} busy={busy} testID="mark-save" block />}>
      <View style={{ gap: 14 }}>
        <SegmentedField label="Status" options={STATUS_OPTIONS} value={status} onChange={setStatus} testID="mark-status" />
        <TextField label="Note for the class" optional value={note} onChangeText={setNote} placeholder="What to revise, or what was skipped" maxLength={1000} multiline testID="mark-note" />
        {leaf.status !== 'TEACHING' && (
          <Button variant="tonal" label="Reached here — everything before is done" onPress={() => void reach()} busy={busy} testID="mark-reach" block />
        )}
        {err && <Text style={{ color: tokens.color.red }} testID="mark-error">{err}</Text>}
      </View>
    </Sheet>
  );
}

function AddChapterSheet({ track, onClose, onAdded }: { track: SyllabusTrack; onClose: () => void; onAdded: () => void }) {
  const tokens = useTokens();
  const [title, setTitle] = useState('');
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const parents = track.chapters.map((c) => ({ id: c.id, label: c.title }));
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.request<{ id: string }>('/manage/syllabus/chapters', {
        method: 'POST',
        body: { gradeId: track.summary.gradeId, subjectId: track.summary.subjectId, title: title.trim(), ...(parentId ? { parentId } : {}) },
      });
      onAdded();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not add it.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose} title="Add a chapter" subtitle={`${track.summary.gradeName} · ${track.summary.subjectName}, every section`} testID="add-chapter-sheet"
      footer={<Button label="Add" onPress={() => void save()} disabled={!title.trim()} busy={busy} testID="add-chapter-save" block />}>
      <View style={{ gap: 14 }}>
        <TextField label="Title" value={title} onChangeText={setTitle} placeholder="Chapter or sub-topic" maxLength={160} autoFocus testID="add-chapter-title" />
        {parents.length > 0 && (
          <SelectField label="Under a chapter (optional)" value={parentId} options={[{ id: '', label: 'A chapter of its own' }, ...parents]} onChange={setParentId} testID="add-chapter-parent" />
        )}
        {err && <Text style={{ color: tokens.color.red }} testID="add-chapter-error">{err}</Text>}
      </View>
    </Sheet>
  );
}
