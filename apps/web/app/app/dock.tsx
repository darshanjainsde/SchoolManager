'use client';
import { useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardList, Inbox, Megaphone, Printer, UserPlus, Wallet, X } from 'lucide-react';
import type { ConsoleSearch } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { useHydrated } from '@/lib/use-hydrated';
import { ApiError } from '@/lib/api';
import { rupees, type StudentFees } from '@/lib/fees';
import { RecordPaymentDialog } from '@/components/fees/record-payment-dialog';

/**
 * The dock — the office's most-repeated actions as one-tap drawers, no
 * page-hops. Two of the six perform right here (payment, announcement,
 * enquiry); the other three land you on the exact screen. The dock LEARNS:
 * taps are counted per browser (a local convenience, never sent anywhere)
 * and the order follows this office's actual habits.
 *
 * Every overlay portals to <body> with .skosx — `.sk-anim > *` animates
 * transform on the page root, so an inline fixed element would anchor to the
 * page column and open below the fold (the RecordPaymentDialog lesson).
 */

const TAP_KEY = 'sk-dock-taps';

function bumpTap(key: string): void {
  try {
    const taps = JSON.parse(localStorage.getItem(TAP_KEY) ?? '{}') as Record<string, number>;
    taps[key] = (taps[key] ?? 0) + 1;
    localStorage.setItem(TAP_KEY, JSON.stringify(taps));
  } catch { /* a dock that cannot learn still works */ }
}

function readTaps(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(TAP_KEY) ?? '{}') as Record<string, number>; }
  catch { return {}; }
}

/** Shared overlay: scrim + right-hand drawer, portaled with the theme tokens. */
function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return createPortal(
    <div className="skosx" style={{ position: 'fixed', inset: 0, zIndex: 80 }}>
      <button aria-label="Close" onClick={onClose}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: 'rgba(15,14,30,0.45)', border: 'none', cursor: 'default' }} />
      <div role="dialog" aria-modal="true" aria-label={title}
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 400, maxWidth: '92vw',
          background: 'var(--sk-card)', color: 'var(--sk-ink)', borderLeft: '1px solid var(--sk-line)',
          padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14,
        }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <b style={{ fontSize: 15 }}>{title}</b>
          <button className="sk-btn" data-icon aria-label="Close" onClick={onClose}><X size={15} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 };

/** Find a child by name, then hand over to the fees module's own dialog. */
function PaymentPicker({ onClose }: { onClose: () => void }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [q, setQ] = useState('');
  const [studentId, setStudentId] = useState<string | null>(null);

  const hits = useQuery({
    queryKey: ['console-search', host, q], enabled: !!host && q.trim().length >= 2 && !studentId,
    queryFn: () => api.get<ConsoleSearch>(`/manage/search?q=${encodeURIComponent(q.trim())}`),
  });
  const fees = useQuery({
    queryKey: ['fees-student', host, studentId], enabled: !!host && !!studentId,
    queryFn: () => api.get<StudentFees>(`/manage/fees/students/${studentId}`),
  });

  // The moment the child's fee file arrives, the REAL record dialog takes
  // over — one component for counter payments everywhere, one place a bug
  // can live.
  if (studentId && fees.data) {
    return <RecordPaymentDialog student={fees.data.student} invoices={fees.data.invoices} onClose={onClose} />;
  }

  return (
    <Drawer title="Record a counter payment" onClose={onClose}>
      <label style={field}>
        Who is paying?
        <input className="sk-input" autoFocus placeholder="Type the child's name or admission no…"
          value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {hits.data?.students.map((s) => (
        <button key={s.id} className="sk-btn" style={{ justifyContent: 'space-between' }}
          onClick={() => setStudentId(s.id)}>
          <span>{s.name} <span className="sk-muted">· {s.classLabel ?? '—'}</span></span>
          {s.feesDueMinor > 0 && <span className="sk-pill" data-tone="warn">{rupees(s.feesDueMinor)} due</span>}
        </button>
      ))}
      {hits.data && hits.data.students.length === 0 && q.trim().length >= 2 && (
        <p className="sk-state">Nobody matches — try a shorter part of the name.</p>
      )}
      {studentId && fees.isLoading && <p className="sk-state">Opening the fee file…</p>}
    </Drawer>
  );
}

function AnnounceDrawer({ onClose }: { onClose: () => void }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const post = useMutation({
    mutationFn: () => api.post('/manage/announcements', { title: title.trim(), body: body.trim() }),
    onSuccess: () => { onClose(); toast.success('Announced — it is on every portal now.'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'It did not post.'),
  });

  return (
    <Drawer title="Announce to the whole school" onClose={onClose}>
      <label style={field}>Title
        <input className="sk-input" autoFocus maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="PTM this Saturday" />
      </label>
      <label style={field}>Message
        <textarea className="sk-input" rows={5} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="Class III parent–teacher meeting from 2 pm…" style={{ resize: 'vertical' }} />
      </label>
      <p className="sk-muted" style={{ fontSize: 11.5, margin: 0 }}>
        Goes school-wide, to every family&rsquo;s portal and inbox. For one class, use the Announcements screen.
      </p>
      <button className="sk-btn" data-variant="primary" disabled={post.isPending || !title.trim() || !body.trim()}
        onClick={() => post.mutate()}>
        {post.isPending ? 'Publishing…' : 'Publish'}
      </button>
    </Drawer>
  );
}

function EnquiryDrawer({ onClose }: { onClose: () => void }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [parentName, setParentName] = useState('');
  const [phone, setPhone] = useState('');
  const [gradeInterest, setGradeInterest] = useState('');
  const [message, setMessage] = useState('');

  const post = useMutation({
    // The same public endpoint the website's form uses — a walk-in IS an
    // enquiry, and one path means one queue and one NEW badge.
    mutationFn: () => api.post('/public/enquiry', {
      parentName: parentName.trim(), phone: phone.trim(),
      ...(gradeInterest.trim() ? { gradeInterest: gradeInterest.trim() } : {}),
      ...(message.trim() ? { message: message.trim() } : {}),
    }),
    onSuccess: () => { onClose(); toast.success('Enquiry saved — it is in the Admissions queue.'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'It did not save.'),
  });

  return (
    <Drawer title="New enquiry (walk-in / phone)" onClose={onClose}>
      <label style={field}>Parent&rsquo;s name
        <input className="sk-input" autoFocus maxLength={120} value={parentName} onChange={(e) => setParentName(e.target.value)} />
      </label>
      <label style={field}>Phone
        <input className="sk-input" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98xxx xxxxx" />
      </label>
      <label style={field}>Class interested (optional)
        <input className="sk-input" maxLength={40} value={gradeInterest} onChange={(e) => setGradeInterest(e.target.value)} placeholder="Nursery / Class VI" />
      </label>
      <label style={field}>Notes (optional)
        <textarea className="sk-input" rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} style={{ resize: 'vertical' }} />
      </label>
      <button className="sk-btn" data-variant="primary" disabled={post.isPending || !parentName.trim() || !phone.trim()}
        onClick={() => post.mutate()}>
        {post.isPending ? 'Saving…' : 'Save enquiry'}
      </button>
    </Drawer>
  );
}

export type DockDrawerKind = 'pay' | 'announce' | 'enquiry';

export function Dock({ hasFees, open, setOpen }: {
  hasFees: boolean;
  open: DockDrawerKind | null;
  setOpen: (k: DockDrawerKind | null) => void;
}) {
  const hydrated = useHydrated();

  const buttons = [
    ...(hasFees ? [{ key: 'pay', label: 'Record payment', icon: Wallet, run: () => setOpen('pay') }] : []),
    { key: 'enquiry', label: 'New enquiry', icon: Inbox, run: () => setOpen('enquiry') },
    { key: 'announce', label: 'Announce', icon: Megaphone, run: () => setOpen('announce') },
    { key: 'press', label: 'Print / issue', icon: Printer, href: '/app/press' },
    { key: 'staffatt', label: 'Staff attendance', icon: ClipboardList, href: '/app/staff-attendance' },
    { key: 'student', label: 'Add student', icon: UserPlus, href: '/app/students' },
  ] as const;

  // Habit order: most-tapped first. Read after hydration only — the server
  // cannot know this browser's habits, and a mismatched first paint would
  // cost the whole subtree under React 19.
  const taps = hydrated ? readTaps() : {};
  const ordered = [...buttons].sort((a, b) => (taps[b.key] ?? 0) - (taps[a.key] ?? 0));

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 9, alignContent: 'start' }}>
        {ordered.map((b) => {
          const inner = (
            <>
              <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--sk-brand-tint)', color: 'var(--sk-brand-2)' }}>
                <b.icon size={15} />
              </span>
              {b.label}
            </>
          );
          const style: React.CSSProperties = {
            display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center',
            padding: '12px 8px', fontSize: 12, fontWeight: 650, textAlign: 'center',
          };
          return 'href' in b ? (
            <Link key={b.key} href={b.href} className="sk-btn sk-press" style={style} onClick={() => bumpTap(b.key)}>
              {inner}
            </Link>
          ) : (
            <button key={b.key} className="sk-btn sk-press" style={style} onClick={() => { bumpTap(b.key); b.run(); }}>
              {inner}
            </button>
          );
        })}
      </div>

      {hydrated && open === 'pay' && <PaymentPicker onClose={() => setOpen(null)} />}
      {hydrated && open === 'announce' && <AnnounceDrawer onClose={() => setOpen(null)} />}
      {hydrated && open === 'enquiry' && <EnquiryDrawer onClose={() => setOpen(null)} />}
    </>
  );
}
