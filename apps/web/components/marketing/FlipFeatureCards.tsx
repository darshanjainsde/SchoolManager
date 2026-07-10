'use client';
import { useRef, useState } from 'react';
import { submitLead } from './marketing-client';

interface Feature {
  icon: string;
  tone: 't' | 'v' | 'c' | 'g' | 's';
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  { icon: '🎓', tone: 't', title: 'A website parents trust', body: 'Courses, admissions, hall of fame, gallery, staff — beautifully designed, updated by you in minutes, live on your own domain.' },
  { icon: '📥', tone: 's', title: 'Admissions & enquiry engine', body: 'Every parent enquiry lands in one inbox with status tracking — from homepage, course cards and admission pages.' },
  { icon: '🏆', tone: 'g', title: 'Events beyond your gate', body: 'Publish school events — then join the Sckools network where schools compete, co-host and win together.' },
  { icon: '🗂️', tone: 'v', title: 'Management suite', body: 'Students, staff, grades, attendance and fees — so simple your office staff masters it on day one.' },
  { icon: '⚡', tone: 'c', title: 'Frequent updates, free', body: 'New features ship every month to every school automatically. Your site never goes stale like an agency build.' },
  { icon: '🛠️', tone: 't', title: 'Custom features on us', body: 'First 2 months after onboarding: tell us what your school needs and we build it into the platform for you.' },
];

/**
 * Click flips the card to a phone-capture form; the lead is tagged with the
 * feature title so the owner inbox shows exactly which pitch hooked them.
 * The `rv` reveal class stays on the STATIC outer wrapper — the flip state
 * only ever rewrites the inner .fl className (learned the hard way on the
 * public-site course cards).
 */
function FlipCard({ feature, delay }: { feature: Feature; delay: number }) {
  const [flipped, setFlipped] = useState(false);
  const [state, setState] = useState<'form' | 'sending' | 'sent'>('form');
  const [phone, setPhone] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function send() {
    if (!phone.trim()) {
      input.current?.focus();
      return;
    }
    setState('sending');
    await submitLead({ phone: phone.trim(), interest: feature.title, source: `flip:${feature.title}` });
    setState('sent');
    setTimeout(() => {
      setFlipped(false);
      setTimeout(() => {
        setState('form');
        setPhone('');
      }, 600);
    }, 2400);
  }

  return (
    <div className="rv" style={{ transitionDelay: `${delay}s` }}>
      <div className={'fl' + (flipped ? ' flipped' : '')}>
        <div
          className="face front"
          onClick={() => {
            setFlipped(true);
            setTimeout(() => input.current?.focus(), 450);
          }}
        >
          <span className="peek" aria-hidden>↻</span>
          <div className={`ic ${feature.tone}`}>{feature.icon}</div>
          <h3>{feature.title}</h3>
          <p>{feature.body}</p>
          <span className="cb">Request a callback →</span>
        </div>
        <div className="face back">
          <button className="x" aria-label="Close" onClick={(e) => { e.stopPropagation(); setFlipped(false); }}>✕</button>
          {state === 'sent' ? (
            <div className="ok">
              <div className="tick">✓</div>
              <b>We&rsquo;ll call you!</b>
              <p>Your number is with our team — expect a call soon.</p>
            </div>
          ) : (
            <div className="bform">
              <h4>📞 We&rsquo;ll call you</h4>
              <p>About: <b>{feature.title}</b></p>
              <input
                ref={input}
                type="tel"
                placeholder="+91 your phone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.key === 'Enter' && send()}
              />
              <button className="btn btn-hot btn-sm send" disabled={state === 'sending'} onClick={(e) => { e.stopPropagation(); void send(); }}>
                {state === 'sending' ? 'Sending…' : 'Request callback →'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FlipFeatureCards() {
  return (
    <div className="grid feat" style={{ marginTop: 38 }}>
      {FEATURES.map((f, i) => (
        <FlipCard key={f.title} feature={f} delay={(i % 3) * 0.07} />
      ))}
    </div>
  );
}
