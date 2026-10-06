'use client';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DESK_SOURCES, type DeskSource } from '@skoolos/types';
import { Field, FieldRow, Overlay } from '@/components/ui/kit';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';

/** How they reached us, in the words the office would say it. */
const SOURCE_WORDS: Record<DeskSource, string> = { WALK_IN: 'Walked in', PHONE: 'Phone call' };

/**
 * A family who walked in or rang — typed at the desk.
 *
 * Posts to POST /site/enquiries, behind the desk guard: owned by whoever typed
 * it, never throttled. The dock's drawer used to post to the public website
 * endpoint, which throttles by IP (one busy morning at one office IP and the
 * sixth walk-in was refused) and wrote "received from the website" on a family
 * standing at the counter.
 *
 * The API refuses an optional field sent as '' (IsEmail is not skipped by
 * IsOptional for an empty string), so every optional field is trimmed and
 * LEFT OUT of the body when it is blank. A refusal is shown inside the drawer
 * and nothing typed is lost.
 */
export function AddEnquiryDrawer({ onClose, onSaved }: { onClose: () => void; onSaved?: (id: string) => void }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [source, setSource] = useState<DeskSource>('WALK_IN');
  const [parentName, setParentName] = useState('');
  const [childName, setChildName] = useState('');
  const [phone, setPhone] = useState('');
  const [gradeInterest, setGradeInterest] = useState('');
  const [message, setMessage] = useState('');
  const [whatsappOk, setWhatsappOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `isPending` only flips after a render; a fast second click can land first.
  const sending = useRef(false);

  const post = useMutation({
    mutationFn: () => api.post<{ id: string }>('/site/enquiries', {
      parentName: parentName.trim(),
      phone: phone.trim(),
      source,
      whatsappOk,
      ...(childName.trim() ? { childName: childName.trim() } : {}),
      ...(gradeInterest.trim() ? { gradeInterest: gradeInterest.trim() } : {}),
      ...(message.trim() ? { message: message.trim() } : {}),
    }),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ['site-enquiries'] });
      onClose();
      if (row?.id) onSaved?.(row.id);
      toast.success('Enquiry saved — it is yours on the Admissions desk.');
    },
    // The drawer stays open and keeps every field: the reason is shown where
    // the person is looking, not in a toast that slides away.
    onError: (e) => setError(e instanceof ApiError ? e.message : 'It did not save. Check your connection and try again.'),
    onSettled: () => { sending.current = false; },
  });

  function save() {
    if (sending.current) return;
    sending.current = true;
    setError(null);
    post.mutate();
  }

  const ready = parentName.trim() !== '' && /\d/.test(phone);

  return (
    <Overlay
      title="New enquiry"
      subtitle="A family who walked in or rang. It is yours on the Admissions desk."
      onClose={onClose}
      footer={(
        <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={post.isPending || !ready} onClick={save}>
          {post.isPending ? 'Saving…' : 'Save enquiry'}
        </button>
      )}
    >
      <div className="sk-enq-filters" role="group" aria-label="How did they reach us?">
        {DESK_SOURCES.map((s) => (
          <button key={s} type="button" className="sk-enq-chip" aria-pressed={source === s} onClick={() => setSource(s)}>
            {SOURCE_WORDS[s]}
          </button>
        ))}
      </div>
      <FieldRow>
        <Field id="enq-parent" label="Parent’s name">
          {(p) => <input {...p} className="sk-input" autoFocus maxLength={120} value={parentName} onChange={(e) => setParentName(e.target.value)} />}
        </Field>
        <Field id="enq-child" label="Child’s name (optional)">
          {(p) => <input {...p} className="sk-input" maxLength={120} value={childName} onChange={(e) => setChildName(e.target.value)} />}
        </Field>
      </FieldRow>
      <FieldRow>
        <Field id="enq-phone" label="Phone number">
          {(p) => <input {...p} className="sk-input" inputMode="tel" maxLength={20} placeholder="98xxx xxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />}
        </Field>
        <Field id="enq-grade" label="Class interested (optional)">
          {(p) => <input {...p} className="sk-input" maxLength={120} placeholder="Nursery / Class VI" value={gradeInterest} onChange={(e) => setGradeInterest(e.target.value)} />}
        </Field>
      </FieldRow>
      <Field id="enq-note" label="Notes (optional)">
        {(p) => <textarea {...p} className="sk-input" rows={3} maxLength={1000} style={{ resize: 'vertical' }} value={message} onChange={(e) => setMessage(e.target.value)} />}
      </Field>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
        <input type="checkbox" className="sk-check" checked={whatsappOk} onChange={(e) => setWhatsappOk(e.target.checked)} />
        They are happy to get WhatsApp messages from the school
      </label>
      {error ? <p className="sk-state err" role="alert">{error}</p> : null}
    </Overlay>
  );
}
