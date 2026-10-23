'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PromoterApiError, promoterApi, promoterFetch, setPromoterToken, getPromoterToken } from '@/lib/promoter-session';

type Step = 'door' | 'code' | 'name';
type Channel = 'email' | 'whatsapp';

const WHO = ['Teacher', 'Parent, PTA member', 'Tuition owner', 'School supplier', 'Ed consultant', 'Other'];
const EXPECT: { k: string; l: string }[] = [{ k: '1-2', l: '1 – 2' }, { k: '3-5', l: '3 – 5' }, { k: '6-10', l: '6 – 10' }, { k: '10+', l: '10+' }];

const STEPS = [
  { t: 'Create your account', d: 'Verify your email or WhatsApp number, then answer a few questions about who you are and how many schools you can introduce. Your commission is set from that and shown inside your account.' },
  { t: 'Log the schools you know', d: 'The school, the city and the person to call. We check it is not already with us and accept it on the spot. Every move after that shows on your dashboard.' },
  { t: 'Get paid when they go live', d: 'Once the school pays its first invoice, your share is due thirty days later. Statement, tax line and all.' },
];
const WHO_SUITS = [
  ['Teachers', 'You know what the office struggles with. So does your principal.'],
  ['Parents on the PTA', 'You sit in the meetings where the website and the app get discussed.'],
  ['Tuition and coaching owners', 'Principals send you students; you can send them Sckools.'],
  ['School suppliers', 'Printers, uniform and book vendors visit twenty schools a month.'],
  ['Consultants', 'Affiliation, audits, training. You already have the diary.'],
];
const RULES = [
  'The person at the school must know you are sharing their number and expect our call.',
  'The first accepted referral for a school is the one that counts, for ninety days.',
  'A school already talking to us, or already live, cannot be referred.',
  'You share our brochure; you do not promise prices, dates or features.',
  'You are paid once per school, after its first payment clears.',
  'Tax is deducted where the law asks; your statement shows gross, tax and net.',
];
const FAQ = [
  ['How much do I earn?', 'A share of the school\'s first-year payment. The exact percentage is set for your account after the questionnaire, and shown there before you log your first school.'],
  ['When am I paid?', 'Thirty days after the school\'s first payment to Sckools clears, to the bank account or UPI id in your account.'],
  ['What if someone else refers the same school?', 'The first accepted referral wins. We tell you at once if a school is already referred or already with us.'],
  ['I work at a school. Can I refer it?', 'Yes, unless you are the person who signs the contract.'],
  ['What about tax?', 'Commission to an individual attracts TDS past a yearly threshold. We deduct it and show it on every statement. We need your PAN before the first payout.'],
];

export default function EarnPage() {
  const router = useRouter();
  const doorRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step>('door');
  const [channel, setChannel] = useState<Channel>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [who, setWho] = useState('');
  const [expect, setExpect] = useState('');
  const [areas, setAreas] = useState('');
  const [know, setKnow] = useState('');
  const [agree, setAgree] = useState(false);
  const [challenge, setChallenge] = useState<{ id: string; to: string; exists: boolean; via: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field?: string; msg: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [whatsappOpen, setWhatsappOpen] = useState<boolean | null>(null);

  // Already signed in: the door leads straight to the dashboard.
  useEffect(() => { if (getPromoterToken()) router.replace('/promoter'); }, [router]);
  // Which doors are open today: the WhatsApp button is offered only when the platform can send a code.
  useEffect(() => { promoterFetch<{ email: boolean; whatsapp: boolean }>('/promoter/auth/channels', {}, { auth: false }).then((c) => setWhatsappOpen(!!c.whatsapp)).catch(() => setWhatsappOpen(false)); }, []);
  useEffect(() => { if (window.location.hash === '#signin') doorRef.current?.scrollIntoView({ block: 'start' }); }, []);
  useEffect(() => { if (!cooldown) return; const t = setTimeout(() => setCooldown((c) => c - 1), 1000); return () => clearTimeout(t); }, [cooldown]);

  const fail = (e: unknown) => {
    const x = e instanceof PromoterApiError ? e : null;
    setErr({ field: x?.field, msg: x?.message || 'Something went wrong. Try again.' });
  };

  async function start() {
    setErr(null);
    if (channel === 'email' && !/^\S+@\S+\.\S+$/.test(email.trim())) return setErr({ field: 'email', msg: 'Enter the email address you can open right now.' });
    if (channel === 'whatsapp' && phone.replace(/\D/g, '').length < 10) return setErr({ field: 'phone', msg: 'Enter your ten-digit WhatsApp number.' });
    setBusy(true);
    try {
      const r = await promoterApi.public.post<{ challengeId: string; to: string; exists: boolean; sentVia: string[] }>('/promoter/auth/start', channel === 'email' ? { channel, email: email.trim() } : { channel, phone: phone.trim() });
      setChallenge({ id: r.challengeId, to: r.to, exists: r.exists, via: r.sentVia[0] ?? channel });
      setCode('');
      setStep(r.exists ? 'code' : 'name');
      setCooldown(60);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function verify(withName = false) {
    setErr(null);
    if (!/^\d{6}$/.test(code.trim())) return setErr({ field: 'code', msg: 'The code is six digits.' });
    if (withName) {
      if (name.trim().length < 2) return setErr({ field: 'name', msg: 'Your name is needed to open the account.' });
      if (!who || !expect) return setErr({ field: 'who', msg: 'Pick who you are and how many schools you can introduce; they decide your rate.' });
      if (!agree) return setErr({ field: 'agree', msg: 'Tick the rules; we only call people who expect it.' });
    }
    setBusy(true);
    try {
      const r = await promoterApi.public.post<{ accessToken: string; isNew: boolean }>('/promoter/auth/verify', { challengeId: challenge!.id, code: code.trim(), ...(withName ? { name: name.trim(), city: city.trim() || undefined } : {}) });
      setPromoterToken(r.accessToken);
      if (withName) {
        // The questionnaire rides on the first signed-in call, so the account and its answers land together.
        await promoterApi.patch('/promoter/me', { who, expect, areas: areas.trim() || undefined, know: know.trim() || undefined }).catch(() => undefined);
      }
      router.replace('/promoter');
    } catch (e) {
      const x = e instanceof PromoterApiError ? e : null;
      if (x?.code === 'PROMOTER_NAME_REQUIRED' && !withName) { setStep('name'); return; }
      fail(e);
    } finally { setBusy(false); }
  }

  const prog = (n: number) => <div className="earn-prog" aria-hidden="true">{[1, 2, 3].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}</div>;
  const errLine = <p className="earn-err" role="alert" aria-live="polite">{err?.msg ?? ''}</p>;
  const inv = (f: string) => (err?.field === f ? true : undefined);

  return (
    <div className="mkt">
      <header className="lp-hero">
        <div className="wrap earn-hero">
          <div>
            <span className="eyebrow">Refer &amp; earn</span>
            <h1 className="h-lg lp-h1">Know a school? Earn when it goes live.</h1>
            <p className="lede">Introduce a school to Sckools. We do the demo, the proposal and the onboarding. When the school goes live and pays, you are paid a share of it.</p>
            <div className="earn-actions">
              <button type="button" className="earn-btn" onClick={() => doorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Create your account</button>
              <a className="earn-btn ghost" href="#how">How it works</a>
            </div>
            <p className="earn-fine">Your exact commission is set for you inside your account, after a two-minute questionnaire. Nothing to pay, nothing to sell.</p>
          </div>
          <div className="earn-promise" aria-label="What happens">
            <div><i aria-hidden="true">🏫</i><div><b>You bring the introduction</b><span>A school you know and a person there who expects our call.</span></div></div>
            <div><i aria-hidden="true">🤝</i><div><b>We do the selling</b><span>Demo, proposal, paperwork, onboarding. You watch every step in your account.</span></div></div>
            <div><i aria-hidden="true">💸</i><div><b>You are paid when they are live</b><span>A share of the school&rsquo;s first payment, to your bank or UPI, with a statement.</span></div></div>
          </div>
        </div>
      </header>

      <section className="lp-sec" id="how" aria-label="How it works">
        <div className="wrap">
          <span className="eyebrow">How it works</span>
          <h2 className="h-lg">Three steps, one of them yours.</h2>
          <div className="earn-steps">
            {STEPS.map((s, i) => <div className="earn-step" key={s.t}><div className="n" aria-hidden="true">{i + 1}</div><b>{s.t}</b><p>{s.d}</p></div>)}
          </div>
        </div>
      </section>

      <section className="lp-sec alt" aria-label="Who it suits">
        <div className="wrap">
          <span className="eyebrow">Who it suits</span>
          <h2 className="h-lg">Anyone a principal already trusts.</h2>
          <div className="lp-grid">
            {WHO_SUITS.map(([t, d]) => <div className="lp-card" key={t}><b>{t}</b><p>{d}</p></div>)}
          </div>
        </div>
      </section>

      <section className="lp-sec" aria-label="The rules">
        <div className="wrap">
          <span className="eyebrow">The rules, in plain words</span>
          <h2 className="h-lg">Simple, and the same for everyone.</h2>
          <ul className="earn-rules">{RULES.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      </section>

      <section className="lp-sec alt" aria-label="Questions">
        <div className="wrap earn-faq">
          <span className="eyebrow">Questions</span>
          <h2 className="h-lg">Before you ask.</h2>
          {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
        </div>
      </section>

      <section className="lp-sec" id="signin" aria-label="Create your account or sign in">
        <div className="wrap" ref={doorRef}>
          <div className="earn-card">
            {step === 'door' && (
              <>
                {prog(1)}
                <h3>Create your account, or sign in</h3>
                <p className="hint">One door for both. A one-time code arrives {whatsappOpen === false ? 'by email' : 'by email or on WhatsApp'}; no password to remember.</p>
                <div className="earn-f">
                  {whatsappOpen !== false && (
                    <div className="earn-seg" role="group" aria-label="Where should the code go?">
                      <button type="button" aria-pressed={channel === 'email'} onClick={() => setChannel('email')}>Email me a code</button>
                      <button type="button" aria-pressed={channel === 'whatsapp'} onClick={() => setChannel('whatsapp')}>WhatsApp me a code</button>
                    </div>
                  )}
                  {channel === 'email' ? (
                    <label>Email<input id="earn-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-invalid={inv('email')} onKeyDown={(e) => e.key === 'Enter' && void start()} /></label>
                  ) : (
                    <label>WhatsApp number<input id="earn-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" aria-invalid={inv('phone')} onKeyDown={(e) => e.key === 'Enter' && void start()} /></label>
                  )}
                  {errLine}
                  <div className="earn-btns">
                    <button type="button" className="earn-btn" disabled={busy} onClick={() => void start()}>{busy ? 'Sending…' : 'Send me a code'}</button>
                  </div>
                </div>
              </>
            )}

            {step === 'code' && challenge && (
              <>
                {prog(2)}
                <h3>{challenge.exists ? 'Welcome back' : 'Check your ' + (challenge.via === 'email' ? 'email' : 'WhatsApp')}</h3>
                <p className="hint">We sent a six-digit code to <b>{challenge.to}</b>. It is valid for ten minutes.</p>
                <div className="earn-f">
                  <label>Code<input id="earn-code" className="earn-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••••" aria-invalid={inv('code')} onKeyDown={(e) => e.key === 'Enter' && void verify(false)} /></label>
                  {errLine}
                  <div className="earn-btns">
                    <button type="button" className="earn-btn" disabled={busy} onClick={() => void verify(false)}>{busy ? 'Checking…' : 'Continue'}</button>
                    <button type="button" className="earn-btn ghost" disabled={busy || cooldown > 0} onClick={() => void start()}>{cooldown > 0 ? `Send again in ${cooldown}s` : 'Send the code again'}</button>
                    <button type="button" className="earn-link" onClick={() => { setStep('door'); setErr(null); }}>Use a different {channel === 'email' ? 'email' : 'number'}</button>
                  </div>
                </div>
              </>
            )}

            {step === 'name' && challenge && (
              <>
                {prog(3)}
                <h3>A few questions, and you are in</h3>
                <p className="hint">We sent a six-digit code to <b>{challenge.to}</b>. Your answers decide your commission; honest answers get a fair rate, and it can be revised as your referrals go live.</p>
                <div className="earn-f">
                  <label>The code we sent<input id="earn-code2" className="earn-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••••" aria-invalid={inv('code')} /></label>
                  <div className="earn-f2">
                    <label>Your name<input id="earn-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Sharma" aria-invalid={inv('name')} /></label>
                    <label>City (optional)<input id="earn-city" autoComplete="address-level2" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Kota" /></label>
                  </div>
                  <label>Who are you, mostly?
                    <div className="earn-seg" role="group" aria-label="Who are you, mostly?">{WHO.map((w) => <button type="button" key={w} aria-pressed={who === w} onClick={() => setWho(w)}>{w}</button>)}</div>
                  </label>
                  <label>How many schools do you think you can introduce in six months?
                    <div className="earn-seg" role="group" aria-label="How many schools">{EXPECT.map((x) => <button type="button" key={x.k} aria-pressed={expect === x.k} onClick={() => setExpect(x.k)}>{x.l}</button>)}</div>
                  </label>
                  <label>Which cities or areas? (optional)<input id="earn-areas" value={areas} onChange={(e) => setAreas(e.target.value)} placeholder="Kota, Bundi" /></label>
                  <label>How do you know these schools? (optional)<textarea id="earn-know" value={know} onChange={(e) => setKnow(e.target.value)} placeholder="I sit on the PTA of two schools; my brother's press prints for twenty." /></label>
                  <label className="earn-check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} aria-invalid={inv('agree')} /><span>I have read the rules above and I will only share a contact who expects a call from Sckools.</span></label>
                  {errLine}
                  <div className="earn-btns">
                    <button type="button" className="earn-btn" disabled={busy} onClick={() => void verify(true)}>{busy ? 'Opening…' : 'Create my account'}</button>
                    <button type="button" className="earn-btn ghost" disabled={busy || cooldown > 0} onClick={() => void start()}>{cooldown > 0 ? `Send the code again in ${cooldown}s` : 'Send the code again'}</button>
                    <button type="button" className="earn-link" onClick={() => { setStep('door'); setErr(null); }}>Use a different {channel === 'email' ? 'email' : 'number'}</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
