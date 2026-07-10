'use client';
import { useEffect, useRef, useState } from 'react';
import { submitLead } from './marketing-client';

export interface CallbackModalProps {
  /** Pre-selected "Interested in" option (tier or feature name). */
  interest: string | null;
  onClose: () => void;
}

const INTERESTS = ['Just exploring', 'Basic', 'Standard', 'Pro', 'Events Network'];

export default function CallbackModal({ interest, onClose }: CallbackModalProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [school, setSchool] = useState('');
  const [chosen, setChosen] = useState(interest && INTERESTS.includes(interest) ? interest : 'Just exploring');
  const [state, setState] = useState<'form' | 'sending' | 'sent' | 'error'>('form');
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return;
    setState('sending');
    const res = await submitLead({
      name: name.trim() || undefined,
      phone: phone.trim(),
      school: school.trim() || undefined,
      interest: interest && !INTERESTS.includes(interest) ? interest : chosen,
      source: 'modal',
    });
    setState(res === 'ok' ? 'sent' : 'error');
  }

  return (
    <div className="mkt-modal" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="Request a callback">
      <div className="mbox">
        <button className="mclose" onClick={onClose} aria-label="Close">✕</button>
        {state === 'sent' ? (
          <div className="sent">
            <div className="tick">✓</div>
            <h3>We&rsquo;ll call you!</h3>
            <p className="sub" style={{ marginTop: 8 }}>
              Your request is with our team — expect a call within one working day.
            </p>
          </div>
        ) : (
          <form onSubmit={send}>
            <h3>Request a callback</h3>
            <p className="sub">Tell us where to reach you — we&rsquo;ll call within one working day.</p>
            <label htmlFor="cb-name">Your name</label>
            <input id="cb-name" ref={firstField} value={name} onChange={(e) => setName(e.target.value)} placeholder="Principal / Trustee name" />
            <label htmlFor="cb-phone">Phone *</label>
            <input id="cb-phone" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 ..." />
            <label htmlFor="cb-school">School name</label>
            <input id="cb-school" value={school} onChange={(e) => setSchool(e.target.value)} placeholder="Your school" />
            <label htmlFor="cb-interest">Interested in</label>
            <select id="cb-interest" value={chosen} onChange={(e) => setChosen(e.target.value)}>
              {INTERESTS.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
            {state === 'error' && <p className="err">Couldn&rsquo;t send just now — please try again in a minute.</p>}
            <button type="submit" className="btn btn-hot" disabled={state === 'sending'}>
              {state === 'sending' ? 'Sending…' : 'Request callback →'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
