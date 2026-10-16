'use client';
import { useState } from 'react';
import type { SyllabusChapterList } from '@skoolos/types';

/**
 * The chapter list for one class + subject, shared by every section of the
 * class. Add a chapter, add a sub-topic under one, rename, or remove. Remove
 * asks once, inline — the viewer never shows a browser confirm — and the API
 * retires rather than deletes, so a slip costs nothing.
 */
export function ChapterEditor({ list, busy, onAdd, onRename, onRetire }: {
  list: SyllabusChapterList;
  busy?: boolean;
  onAdd: (title: string, parentId?: string) => void;
  onRename: (id: string, title: string) => void;
  onRetire: (id: string) => void;
}) {
  const edit = list.canEdit;
  return (
    <div data-testid="syl-editor">
      {list.chapters.length === 0 && (
        <p className="sk-state" style={{ margin: 0 }}>
          No chapters yet for {list.subjectName} in {list.gradeName}.{edit ? ' Add the first one below — every section of the class will see it.' : ''}
        </p>
      )}
      {list.chapters.map((ch, i) => (
        <section key={ch.id} className="sk-syl-chapter" aria-label={ch.title} data-testid={`syl-edit-${ch.id}`}>
          <Line id={ch.id} title={`${i + 1}. ${ch.title}`} raw={ch.title} edit={edit} busy={busy} onRename={onRename} onRetire={onRetire} />
          {ch.children.map((c) => (
            <div key={c.id} className="sk-syl-leaf sub">
              <Line id={c.id} title={c.title} raw={c.title} edit={edit} busy={busy} onRename={onRename} onRetire={onRetire} small />
            </div>
          ))}
          {edit && <AddBox label={`Add a sub-topic to ${ch.title}`} placeholder="Sub-topic" busy={busy} onAdd={(t) => onAdd(t, ch.id)} testId={`syl-add-sub-${ch.id}`} sub />}
        </section>
      ))}
      {edit && (
        <div className="sk-syl-chapter">
          <AddBox label="Add a chapter" placeholder="Chapter title" busy={busy} onAdd={(t) => onAdd(t)} testId="syl-add-chapter" />
        </div>
      )}
      {!edit && list.chapters.length > 0 && <p className="sk-muted" style={{ fontSize: 12.5, marginTop: 10 }}>Only the admin or a teacher of this subject can change the list.</p>}
    </div>
  );
}

function Line({ id, title, raw, edit, busy, small, onRename, onRetire }: {
  id: string; title: string; raw: string; edit: boolean; busy?: boolean; small?: boolean;
  onRename: (id: string, title: string) => void; onRetire: (id: string) => void;
}) {
  const [mode, setMode] = useState<'view' | 'rename' | 'remove'>('view');
  const [draft, setDraft] = useState(raw);
  if (mode === 'rename') {
    return (
      <form className="sk-syl-add" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { onRename(id, draft.trim()); setMode('view'); } }}>
        <label className="sk-sronly" htmlFor={`syl-rename-${id}`}>New title</label>
        <input id={`syl-rename-${id}`} className="sk-input" value={draft} maxLength={160} onChange={(e) => setDraft(e.target.value)} data-testid={`syl-rename-${id}`} />
        <button type="submit" className="sk-btn sk-press" data-variant="primary" data-size="sm" disabled={busy || !draft.trim()}>Save</button>
        <button type="button" className="sk-btn sk-press" data-size="sm" onClick={() => setMode('view')}>Cancel</button>
      </form>
    );
  }
  return (
    <div className="head">
      <div className="ttl" style={small ? { fontWeight: 600, fontSize: 13.5 } : undefined}>{title}</div>
      {edit && mode === 'view' && (
        <div className="sk-actions">
          <button type="button" className="sk-btn sk-press" data-size="sm" onClick={() => { setDraft(raw); setMode('rename'); }} data-testid={`syl-rename-btn-${id}`}>Rename</button>
          <button type="button" className="sk-btn sk-press" data-size="sm" data-tone="bad" onClick={() => setMode('remove')} data-testid={`syl-remove-btn-${id}`}>Remove</button>
        </div>
      )}
      {edit && mode === 'remove' && (
        <span className="sk-syl-confirm">
          Remove {small ? 'this sub-topic' : 'this chapter and its sub-topics'} from every section?
          <button type="button" className="sk-btn sk-press" data-variant="danger" data-size="sm" disabled={busy} onClick={() => { onRetire(id); setMode('view'); }} data-testid={`syl-remove-yes-${id}`}>Remove</button>
          <button type="button" className="sk-btn sk-press" data-size="sm" onClick={() => setMode('view')}>Keep</button>
        </span>
      )}
    </div>
  );
}

function AddBox({ label, placeholder, busy, onAdd, testId, sub }: { label: string; placeholder: string; busy?: boolean; onAdd: (title: string) => void; testId: string; sub?: boolean }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  if (!open) {
    return (
      <div className={sub ? 'sk-syl-leaf sub' : undefined}>
        <button type="button" className="sk-btn sk-press" data-size="sm" data-variant={sub ? undefined : 'primary'} onClick={() => setOpen(true)} data-testid={`${testId}-open`}>{sub ? '+ Sub-topic' : '+ Add a chapter'}</button>
      </div>
    );
  }
  return (
    <form className={`sk-syl-add${sub ? ' sk-syl-leaf sub' : ''}`} onSubmit={(e) => { e.preventDefault(); const t = title.trim(); if (t) { onAdd(t); setTitle(''); setOpen(false); } }}>
      <label className="sk-sronly" htmlFor={testId}>{label}</label>
      <input id={testId} className="sk-input" placeholder={placeholder} value={title} maxLength={160} autoFocus onChange={(e) => setTitle(e.target.value)} data-testid={testId} />
      <button type="submit" className="sk-btn sk-press" data-variant="primary" data-size="sm" disabled={busy || !title.trim()} data-testid={`${testId}-save`}>Add</button>
      <button type="button" className="sk-btn sk-press" data-size="sm" onClick={() => { setOpen(false); setTitle(''); }}>Cancel</button>
    </form>
  );
}
