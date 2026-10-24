'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Image as ImageIcon, ShieldCheck } from 'lucide-react';
import type { SupportModule, SupportSeverity, SupportTicketDetail, SupportTicketType } from '@skoolos/types';
import { ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Field, Note, Overlay } from '@/components/ui/kit';
import { IMAGE_ACCEPT, MODULE_OPTIONS, SEVERITY_OPTIONS, TYPE_OPTIONS, acceptFiles, browserHint, moduleForPath } from '@/lib/support';

/**
 * REPORT A PROBLEM — the one door a school admin has to Sckools, reachable
 * from every console page. A drawer, not a page, so they never lose the screen
 * that broke; five fields, up to five photos, and a box that shows what the
 * console will say on their behalf (page, plan, browser), so nothing about the
 * report is a surprise to them.
 *
 * Errors land where they belong: a field message under the field, the server's
 * own words for a dead file store (503), a Note for the daily cap (429). The
 * drawer stays open on failure — nothing typed is lost.
 */
export function ReportProblem({ pagePath, onClose, onCreated }: {
  pagePath: string;
  onClose: () => void;
  onCreated?: (ticket: SupportTicketDetail) => void;
}) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [type, setType] = useState<SupportTicketType>('BUG');
  const [module, setModule] = useState<SupportModule>(() => moduleForPath(pagePath));
  const [severity, setSeverity] = useState<SupportSeverity>('ANNOYING');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [allowLookIn, setAllowLookIn] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; body?: string; files?: string }>({});
  const [serverNote, setServerNote] = useState<string | null>(null);

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : undefined;

  const send = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('type', type);
      fd.append('module', module);
      fd.append('severity', severity);
      fd.append('title', title.trim());
      fd.append('body', body.trim());
      fd.append('pagePath', pagePath.slice(0, 200));
      if (allowLookIn) fd.append('allowLookIn', 'true');
      for (const f of files) fd.append('files', f, f.name);
      return api.postForm<SupportTicketDetail>('/manage/support', fd);
    },
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ['support-tickets'] });
      void qc.invalidateQueries({ queryKey: ['support-counts'] });
      toast.success(`Sent as ${t.ticketNo}. We'll reply here and by email.`);
      onCreated?.(t);
      onClose();
    },
    onError: (e: unknown) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setServerNote('You seem to be offline. Your words are still here — try again when you are back.');
        return;
      }
      if (e instanceof ApiError) {
        if (e.status === 413) { setErrors((x) => ({ ...x, files: 'One of the photos is too large. Each one must be under 5 MB.' })); return; }
        if (e.status === 429) { setServerNote(e.message || 'Your school has reached the daily limit for new tickets. Add to an existing one instead.'); return; }
        setServerNote(e.message || 'That could not be sent. Please try again.');
        return;
      }
      setServerNote('That could not be sent. Check your connection and try again.');
    },
  });

  const submit = () => {
    const next: typeof errors = {};
    if (title.trim().length < 3) next.title = 'Give it a short title, at least 3 characters.';
    if (body.trim().length < 3) next.body = 'Tell us what happened, at least a sentence.';
    setErrors(next);
    setServerNote(null);
    if (Object.keys(next).length) return;
    send.mutate();
  };

  return (
    <Overlay
      title="Report a problem"
      subtitle={`from ${pagePath}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="sk-btn" onClick={onClose} disabled={send.isPending}>Cancel</button>
          <button type="button" className="sk-btn sk-press" data-variant="primary" onClick={submit} disabled={send.isPending}>
            {send.isPending ? 'Sending…' : 'Send to Sckools'}
          </button>
        </>
      }
    >
      <div className="sk-sup-form">
        {serverNote && <Note tone="warn">{serverNote}</Note>}

        <fieldset className="sk-sup-fieldset">
          <legend className="sk-lab">What kind of issue</legend>
          <div className="sk-sup-seg" role="group" aria-label="What kind of issue">
            {TYPE_OPTIONS.map((o) => (
              <button key={o.value} type="button" className="sk-btn" aria-pressed={type === o.value} onClick={() => setType(o.value)}>{o.label}</button>
            ))}
          </div>
        </fieldset>

        <Field id="sup-module" label="Which part of Sckools">
          {(p) => (
            <select {...p} className="sk-input" value={module} onChange={(e) => setModule(e.target.value as SupportModule)}>
              {MODULE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
        </Field>

        <fieldset className="sk-sup-fieldset">
          <legend className="sk-lab">How urgent</legend>
          <div className="sk-sup-seg" role="group" aria-label="How urgent">
            {SEVERITY_OPTIONS.map((o) => (
              <button key={o.value} type="button" className="sk-btn" aria-pressed={severity === o.value} onClick={() => setSeverity(o.value)}>{o.label}</button>
            ))}
          </div>
        </fieldset>

        <Field id="sup-title" label="Title" hint={errors.title} invalid={!!errors.title}>
          {(p) => <input {...p} className="sk-input" maxLength={120} value={title} placeholder="e.g. Receipt PDF fails for one student" onChange={(e) => setTitle(e.target.value)} />}
        </Field>

        <Field id="sup-body" label="What happened" hint={errors.body ?? 'What you did, what you expected, what you saw instead.'} invalid={!!errors.body}>
          {(p) => <textarea {...p} className="sk-input" rows={5} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />}
        </Field>

        <div className="sk-field" data-invalid={errors.files ? '' : undefined}>
          <span className="sk-lab" id="sup-files-label">Photos · up to 5</span>
          <div className="sk-sup-attach" aria-labelledby="sup-files-label">
            <label className="sk-btn sk-press" data-size="sm">
              <ImageIcon size={14} aria-hidden="true" /> Add photos
              <input
                id="sup-files" type="file" accept={IMAGE_ACCEPT} multiple className="sk-sronly" data-testid="report-files"
                onChange={(e) => {
                  const { kept, dropped } = acceptFiles(files, Array.from(e.target.files ?? []));
                  setFiles(kept);
                  setErrors((x) => ({ ...x, files: dropped.length ? dropped.join('; ') : undefined }));
                  e.target.value = '';
                }}
              />
            </label>
            {files.map((f) => (
              <span key={f.name + f.size} className="sk-sup-chip">
                {f.name}
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))}>×</button>
              </span>
            ))}
          </div>
          {errors.files && <span className="sk-fieldhint">{errors.files}</span>}
        </div>

        <div className="sk-field">
          <span className="sk-lab">We will attach this for you</span>
          <dl className="sk-sup-ctx">
            <dt>page</dt><dd>{pagePath}</dd>
            <dt>browser</dt><dd>{browserHint(ua)}</dd>
            <dt>school</dt><dd>{host || 'this school'}</dd>
          </dl>
        </div>

        <label className="sk-sup-lookin" data-on={allowLookIn ? '' : undefined}>
          <input type="checkbox" checked={allowLookIn} onChange={(e) => setAllowLookIn(e.target.checked)} />
          <ShieldCheck size={16} aria-hidden="true" />
          <span>
            <b>Allow Sckools to open our console to investigate, for 48 hours</b>
            <small>Every visit is written on the ticket. You can switch this off any time.</small>
          </span>
        </label>
      </div>
    </Overlay>
  );
}
