'use client';
import { useState } from 'react';
import type { SyllabusChapterRow, SyllabusLeaf, SyllabusStatus, SyllabusTrack } from '@skoolos/types';
import { STATUS_LABEL, STATUS_TONE, sinceLine } from './labels';

/**
 * The chapter list of one track. A chapter with sub-topics shows its derived
 * status and its sub-topics are the things that get marked; a chapter without
 * any is marked itself. Three status buttons (the kit's segmented control),
 * "Reached here", and a note for the class — all hidden when `canEdit` is
 * false (the admin, or today's substitute), who read the same rows.
 */
export interface MarkBody {
  status?: SyllabusStatus;
  note?: string;
}

export function ChapterList({ track, busy, onMark, onReach }: {
  track: SyllabusTrack;
  busy?: boolean;
  onMark?: (chapterId: string, body: MarkBody) => void;
  onReach?: (chapterId: string) => void;
}) {
  const edit = track.canEdit && !!onMark;
  if (!track.chapters.length) {
    return <p className="sk-state" style={{ margin: 0 }}>No chapters yet for this subject. Add the chapter list and every section of the class gets it.</p>;
  }
  return (
    <div data-testid="syl-chapters">
      {track.chapters.map((ch, i) => (
        <section key={ch.id} className="sk-syl-chapter" aria-label={ch.title} data-testid={`syl-ch-${ch.id}`}>
          <div className="head">
            <div className="ttl">
              {i + 1}. {ch.title}
              {ch.children.length > 0 && <small>{ch.children.filter((c) => c.status === 'DONE').length} of {ch.children.length} sub-topics done</small>}
            </div>
            <span className="sk-pill" data-tone={STATUS_TONE[ch.status]}>{STATUS_LABEL[ch.status]}</span>
          </div>
          {ch.children.length === 0 ? (
            <Leaf leaf={ch} edit={edit} busy={busy} onMark={onMark} onReach={onReach} now={track.summary.now?.chapterId === ch.id} />
          ) : (
            <>
              {edit && <NoteBox leaf={ch} busy={busy} onSave={(note) => onMark?.(ch.id, { note })} />}
              {!edit && ch.note && <TeacherNote leaf={ch} />}
              {ch.children.map((c) => (
                <Leaf key={c.id} leaf={c} sub edit={edit} busy={busy} onMark={onMark} onReach={onReach} now={track.summary.now?.chapterId === c.id} />
              ))}
            </>
          )}
        </section>
      ))}
    </div>
  );
}

function Leaf({ leaf, sub, edit, busy, onMark, onReach, now }: {
  leaf: SyllabusLeaf | SyllabusChapterRow;
  sub?: boolean;
  edit: boolean;
  busy?: boolean;
  onMark?: (chapterId: string, body: MarkBody) => void;
  onReach?: (chapterId: string) => void;
  now: boolean;
}) {
  return (
    <div className={`sk-syl-leaf${sub ? ' sub' : ''}`} data-testid={`syl-leaf-${leaf.id}`}>
      {sub && (
        <div className="head">
          <div className="ttl" style={{ fontWeight: 600, fontSize: 13.5 }}>{leaf.title}{now && <small>Where the class is now</small>}</div>
          {!edit && <span className="sk-pill" data-tone={STATUS_TONE[leaf.status]}>{STATUS_LABEL[leaf.status]}</span>}
        </div>
      )}
      {edit ? (
        <>
          <div className="ctl">
            <div className="sk-seg" role="group" aria-label={`Status of ${leaf.title}`}>
              {(['NOT_STARTED', 'TEACHING', 'DONE'] as const).map((s) => (
                <button key={s} type="button" aria-pressed={leaf.status === s} disabled={busy} onClick={() => leaf.status !== s && onMark?.(leaf.id, { status: s })} data-testid={`syl-status-${leaf.id}-${s}`}>
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            {onReach && leaf.status !== 'TEACHING' && (
              <button type="button" className="sk-btn sk-press" data-size="sm" disabled={busy} onClick={() => onReach(leaf.id)} data-testid={`syl-reach-${leaf.id}`} title="Everything before this is done; this is being taught">
                Reached here
              </button>
            )}
          </div>
          <NoteBox leaf={leaf} busy={busy} onSave={(note) => onMark?.(leaf.id, { note })} />
        </>
      ) : (
        leaf.note && <TeacherNote leaf={leaf} />
      )}
      {leaf.updatedAt && <span className="sk-muted" style={{ fontSize: 12 }}>{leaf.updatedBy ? `${leaf.updatedBy} · ` : ''}{sinceLine(leaf.updatedAt)}</span>}
    </div>
  );
}

function TeacherNote({ leaf }: { leaf: SyllabusLeaf }) {
  return <blockquote className="sk-syl-quote"><b>Teacher&rsquo;s note</b>{leaf.note}</blockquote>;
}

/** The class note: shown as a quote, a textarea while editing, saved on its own. */
function NoteBox({ leaf, busy, onSave }: { leaf: SyllabusLeaf; busy?: boolean; onSave: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(leaf.note ?? '');
  if (!open) {
    return (
      <div className="sk-syl-note">
        {leaf.note ? <blockquote className="sk-syl-quote"><b>Note for the class</b>{leaf.note}</blockquote> : null}
        <div className="row">
          <button type="button" className="sk-btn sk-press" data-size="sm" onClick={() => { setDraft(leaf.note ?? ''); setOpen(true); }} data-testid={`syl-note-edit-${leaf.id}`}>
            {leaf.note ? 'Edit note' : 'Add a note'}
          </button>
        </div>
      </div>
    );
  }
  const id = `syl-note-${leaf.id}`;
  return (
    <div className="sk-syl-note">
      <label className="sk-sronly" htmlFor={id}>Note for the class on {leaf.title}</label>
      <textarea id={id} value={draft} maxLength={1000} placeholder="What the class should revise, or what was skipped" onChange={(e) => setDraft(e.target.value)} data-testid={id} />
      <div className="row">
        <button type="button" className="sk-btn sk-press" data-variant="primary" data-size="sm" disabled={busy} onClick={() => { onSave(draft.trim()); setOpen(false); }} data-testid={`syl-note-save-${leaf.id}`}>Save note</button>
        <button type="button" className="sk-btn sk-press" data-size="sm" onClick={() => setOpen(false)}>Cancel</button>
        {draft.length > 750 && <span className="sk-muted">{1000 - draft.length} left</span>}
      </div>
    </div>
  );
}
