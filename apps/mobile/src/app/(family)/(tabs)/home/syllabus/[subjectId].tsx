import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { StudentSyllabusChapter, StudentSyllabusLeaf, StudentSyllabusSubjectDetail } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { useReload } from '@/lib/query';
import { Card, Empty, ErrorState, Figure, ListScreen, Pill, SectionTitle, Toast } from '@/components/ui';
import { Button } from '@/components/Button';
import { Chip, ChipRow } from '@/components/Chip';
import { TextField } from '@/components/Field';
import { LoadingRows } from '@/components/Loading';
import { Sheet } from '@/components/Sheet';
import { RingLegend, Rings } from '@/components/Rings';
import { STATUS_LABEL, STATUS_TONE, ringColors } from '@/lib/syllabus';
import { useTokens } from '@/theme/theme-context';

type Filter = 'ALL' | 'REVISE' | 'DONE';
type RowItem =
  | { kind: 'chapter'; ch: StudentSyllabusChapter; index: number }
  | { kind: 'leaf'; leaf: StudentSyllabusLeaf; sub: boolean; index: number };

/**
 * One subject for a child: the chapters in order, what the teacher said, and
 * my own note — nobody else reads it. "To revise" keeps what has been taught
 * and has no note yet; writing the note is what moves the blue ring.
 */
export default function FamilySubjectScreen() {
  const { subjectId } = useLocalSearchParams<{ subjectId: string }>();
  const tokens = useTokens();
  const colors = ringColors(tokens.color);
  const [reloadKey, reload] = useReload();
  const [data, setData] = useState<StudentSyllabusSubjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [open, setOpen] = useState<StudentSyllabusLeaf | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      api
        .request<StudentSyllabusSubjectDetail>(`/me/syllabus/subjects/${encodeURIComponent(subjectId ?? '')}`)
        .then((d) => { if (!cancelled) setData(d); })
        .catch((e: unknown) => { if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.'); });
      return () => { cancelled = true; };
    }, [subjectId, reloadKey]),
  );

  const show = useCallback((l: StudentSyllabusLeaf) => filter === 'ALL' || (filter === 'DONE' ? l.status === 'DONE' : l.status === 'DONE' && !l.myNote), [filter]);
  const rows = useMemo(() => {
    const out: RowItem[] = [];
    (data?.chapters ?? []).forEach((ch, index) => {
      if (ch.children.length === 0) { if (show(ch)) out.push({ kind: 'leaf', leaf: ch, sub: false, index }); return; }
      const kids = ch.children.filter(show);
      if (!kids.length) return;
      out.push({ kind: 'chapter', ch, index });
      for (const c of kids) out.push({ kind: 'leaf', leaf: c, sub: true, index });
    });
    return out;
  }, [data, show]);

  const s = data?.subject;
  const toRevise = s ? Math.max(0, s.done - s.revised) : 0;

  const header = (
    <View style={{ gap: 12 }}>
      <SectionTitle title={s ? s.subjectName : 'Syllabus'} />
      {error && <ErrorState error={error} onRetry={reload} testID="subject-error" />}
      {data === null && !error && <LoadingRows label="Opening…" rows={5} />}
      {data && s && (
        <>
          <Card testID="subject-hero">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Rings
                outer={{ pct: s.pct, color: colors.taught, label: 'Taught' }}
                inner={{ pct: s.revisedPct, color: colors.revised, label: 'Revised by me' }}
                size={96} stroke={11} centre={`${s.pct}%`}
              />
              <View style={{ flex: 1, gap: 8, minWidth: 0 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: tokens.color.ink }}>
                  {toRevise ? `${toRevise} ${toRevise === 1 ? 'topic' : 'topics'} to revise` : s.done ? 'Everything taught is revised' : 'Nothing taught yet'}
                </Text>
                <RingLegend
                  outer={{ pct: s.pct, color: colors.taught, label: 'Taught' }}
                  inner={{ pct: s.revisedPct, color: colors.revised, label: 'Revised by me' }}
                />
                <Text style={{ fontSize: 12.5, color: tokens.color.sub }}>{s.teacher ?? 'Teacher not on the timetable'}{s.now ? ` · Now: ${s.now.title}` : ''}</Text>
              </View>
            </View>
          </Card>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Figure label="Taught" value={`${s.done} / ${s.leaves}`} />
            <Figure label="Revised by me" value={`${s.revised}`} />
            <Figure label="To revise" value={`${toRevise}`} tone={toRevise ? 'warn' : undefined} />
          </View>
          <ChipRow testID="subject-filters">
            <Chip label="All" selected={filter === 'ALL'} onPress={() => setFilter('ALL')} testID="subject-filter-ALL" />
            <Chip label={toRevise ? `To revise · ${toRevise}` : 'To revise'} selected={filter === 'REVISE'} onPress={() => setFilter('REVISE')} testID="subject-filter-REVISE" />
            <Chip label="Taught" selected={filter === 'DONE'} onPress={() => setFilter('DONE')} testID="subject-filter-DONE" />
          </ChipRow>
        </>
      )}
    </View>
  );

  const empty = data && !error ? (
    data.chapters.length === 0 ? (
      <Empty kind="first" icon="syllabus" title="No chapters yet" testID="subject-empty">Your teacher adds them, and this fills in.</Empty>
    ) : (
      <Empty kind="done" title={filter === 'REVISE' ? 'Nothing left to revise' : 'Nothing taught yet'} art={false} testID="subject-filter-empty">
        {filter === 'REVISE' ? 'Every taught topic has your note on it.' : 'The class has not reached a topic yet.'}
      </Empty>
    )
  ) : null;

  return (
    <>
      <ListScreen
        data={rows}
        keyExtractor={(r) => (r.kind === 'chapter' ? `c:${r.ch.id}` : `l:${r.leaf.id}`)}
        header={header}
        empty={empty}
        onRefresh={reload}
        testID="subject-list"
        renderItem={(r) =>
          r.kind === 'chapter' ? (
            <View style={{ paddingTop: 10, paddingHorizontal: 4, gap: 2 }} testID={`subject-ch-${r.ch.id}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: tokens.color.ink }}>{`${r.index + 1}. ${r.ch.title}`}</Text>
                <Pill tone={STATUS_TONE[r.ch.status]}>{STATUS_LABEL[r.ch.status]}</Pill>
              </View>
              {r.ch.teacherNote ? <Text style={{ fontSize: 13, color: tokens.color.ink2 }}>{`Teacher: ${r.ch.teacherNote}`}</Text> : null}
            </View>
          ) : (
            <Pressable
              testID={`subject-leaf-${r.leaf.id}`}
              onPress={() => setOpen(r.leaf)}
              accessibilityRole="button"
              accessibilityLabel={`${r.leaf.title}, ${STATUS_LABEL[r.leaf.status]}${r.leaf.myNote ? ', has my note' : ''}`}
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
                {r.leaf.teacherNote ? <Text style={{ fontSize: 13, color: tokens.color.ink2 }}>{`Teacher: ${r.leaf.teacherNote}`}</Text> : null}
                <Text style={{ fontSize: 13, color: r.leaf.myNote ? colors.revised : tokens.color.sub }} numberOfLines={2}>
                  {r.leaf.myNote ? `My note: ${r.leaf.myNote}` : r.leaf.status === 'DONE' ? 'Tap to write your note and mark it revised' : 'Tap to write a note'}
                </Text>
              </Card>
            </Pressable>
          )
        }
      />
      {open && (
        <NoteSheet
          leaf={open}
          onClose={() => setOpen(null)}
          onSaved={(msg) => { setOpen(null); setToast(msg); reload(); }}
        />
      )}
      {toast && <Toast kind="success" message={toast} testID="subject-toast" />}
    </>
  );
}

function NoteSheet({ leaf, onClose, onSaved }: { leaf: StudentSyllabusLeaf; onClose: () => void; onSaved: (msg: string) => void }) {
  const tokens = useTokens();
  const [body, setBody] = useState(leaf.myNote ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const put = async (text: string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.request<{ chapterId: string; myNote: string | null }>(`/me/syllabus/notes/${encodeURIComponent(leaf.id)}`, { method: 'PUT', body: { body: text } });
      onSaved(r.myNote ? 'Note saved — marked revised.' : 'Note removed.');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose} title={leaf.title} subtitle={`${STATUS_LABEL[leaf.status]} · your note is yours alone`} testID="note-sheet"
      footer={<Button label={leaf.myNote ? 'Save' : 'Save and mark revised'} onPress={() => void put(body.trim())} disabled={!body.trim() || body.trim() === (leaf.myNote ?? '')} busy={busy} testID="note-save" block />}>
      <View style={{ gap: 14 }}>
        {leaf.teacherNote ? <Text style={{ fontSize: 13, color: tokens.color.ink2 }}>{`Teacher: ${leaf.teacherNote}`}</Text> : null}
        <TextField label="My note" value={body} onChangeText={setBody} placeholder="What to remember from this topic" maxLength={2000} multiline autoFocus testID="note-body" />
        {leaf.myNote ? <Button variant="text" label="Remove my note" onPress={() => void put('')} busy={busy} testID="note-clear" /> : null}
        {err && <Text style={{ color: tokens.color.red }} testID="note-error">{err}</Text>}
      </View>
    </Sheet>
  );
}
