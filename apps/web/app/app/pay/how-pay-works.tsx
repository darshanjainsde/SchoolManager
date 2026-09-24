'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

/**
 * HOW PAY WORKS — the real screens, walked through, with a pointer.
 *
 * Six tabs in the order a school actually meets them: Settings (where the
 * school is decides provident fund, ESI and professional tax — and is silently
 * zero when unset), Grades, People, This month, Payslips, Filings. Seventeen
 * steps, each captioned and clickable, so an admin can watch once or jump to
 * the one they are stuck on.
 *
 * Three rules from the UI ledger shape how it is built:
 *  - NOTHING IS HIDDEN WAITING FOR JAVASCRIPT. Every scene renders in full as
 *    a storyboard; the script only ever ADDS `data-hide`. A background tab, a
 *    stalled timer or no script at all still shows the finished screens.
 *  - NO NUMBER EVER COUNTS UP. Every figure is static text swapped between
 *    states, so a stalled animation can never strand a value that was never true.
 *  - REDUCED MOTION collapses to the end state: no autoplay, no pointer, the
 *    step list still works by click.
 *
 * "Hide" is a per-viewer convenience kept in localStorage (wrapped, because
 * it can throw or come back empty); the parent shows a "How this works" link
 * to bring it back. The stylesheet block is `sk-hpw*` in sk-theme.css.
 */

const KEY = 'pay.howItWorks.hidden';
const DUR = 2600;

type Tab = 'settings' | 'grades' | 'people' | 'month' | 'payslips' | 'filings';
interface Step { tab: Tab; c: string; at: string | [number, number]; type?: number; lit?: number; press?: string; tick?: boolean; draw?: boolean }

/** The script. `at` is a pointer target: an element id inside the stage, or [x%, y%]. */
const STEPS: Step[] = [
  { tab: 'settings', c: 'Say where the school is. India · Rajasthan. That decides provident fund, ESI and professional tax — set it once, never again.', at: 'hpw-region' },
  { tab: 'settings', c: 'Who may see pay: you, and anyone you name. Nobody else in the office, however senior.', at: 'hpw-access' },
  { tab: 'grades', c: 'Open Grades. Pay drafts your grades from the roll you already have — 8 jobs, from 73 people.', at: [22, 12] },
  { tab: 'grades', c: 'Type the band straight into the draft. Or edit one first — either way, a job gets its range here, once.', at: 'hpw-bandin', type: 4 },
  { tab: 'grades', c: 'Name it the way the school says it out loud: TGT.', at: 'hpw-name', type: 5 },
  { tab: 'grades', c: 'Band ₹30,000 to ₹46,000. A band is guidance — paying outside it is allowed and only ever warns.', at: [72, 52], type: 6 },
  { tab: 'grades', c: 'Leave Basic blank. The default is 50%, and it already meets the Code on Wages rule. Add grade.', at: 'hpw-add', lit: 7, press: 'hpw-add' },
  { tab: 'grades', c: 'Saved. The band and the split are drawn to scale, so a bad one is seen before it is saved — not reported after.', at: [40, 55], draw: true },
  { tab: 'people', c: 'Open People. Everyone still waiting is pinned at the top — not somewhere in the alphabet.', at: [40, 10] },
  { tab: 'people', c: 'Select all 72. One action, not seventy-two ticks.', at: 'hpw-sel', press: 'hpw-sel', tick: true },
  { tab: 'people', c: 'Put them on TGT from 1 October. Everyone starts in the middle of the band; change only who differs.', at: 'hpw-put2', press: 'hpw-put2', tick: true },
  { tab: 'people', c: 'Done — 72 on pay, ₹27,36,000 a month. Bank details and PAN wait behind “More”; nothing blocks this.', at: [40, 30] },
  { tab: 'month', c: 'This month now knows the month, what it costs the school, and the two or three things that need a person.', at: [55, 10] },
  { tab: 'month', c: 'Start October → Work it out → Approve → Lock. Four buttons.', at: 'hpw-lock' },
  { tab: 'payslips', c: 'Every payslip, every month, in one place — and each person sees their own in the app the moment you lock.', at: [50, 40] },
  { tab: 'filings', c: 'Provident fund, ESI and the bank file, ready to upload. Submitting stays with your school and its accountant.', at: 'hpw-dl' },
  { tab: 'month', c: 'Paid. Next month is one button — and April’s raise is one action per grade, not one per person.', at: 'hpw-paid' },
];

const TABS: { key: Tab; label: string }[] = [
  { key: 'month', label: 'This month' }, { key: 'people', label: 'People' }, { key: 'grades', label: 'Grades' },
  { key: 'payslips', label: 'Payslips' }, { key: 'filings', label: 'Filings' }, { key: 'settings', label: 'Settings' },
];

const GROUPS: { title: string; from: number; to: number }[] = [
  { title: 'Where the school is', from: 1, to: 2 },
  { title: 'Make a grade', from: 3, to: 8 },
  { title: 'Put people on it', from: 9, to: 12 },
  { title: 'Run the month', from: 13, to: 14 },
  { title: 'What comes out', from: 15, to: 17 },
];
const SHORT = [
  '', 'Country and state', 'Who may see pay',
  'Open Grades — drafted from your roll', 'Type the band into the draft', 'Name it: TGT', 'Band ₹30,000 – ₹46,000', 'Leave Basic blank · Add grade', 'Saved — band and split drawn',
  'Open People — waiting at the top', 'Select all 72', 'Put 72 on TGT from 1 Oct', 'Done — 72 on pay',
  'This month knows the cost', 'Start → Work out → Approve → Lock',
  'Payslips, one place', 'Filings, ready to upload', 'Paid. Next month is one button',
];

function readHidden(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
function writeHidden(v: boolean) {
  try { if (v) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* per-viewer convenience only */ }
}

/** The small link the parent shows when the walkthrough is hidden. */
export function HowPayWorksLink({ onShow }: { onShow: () => void }) {
  return <button type="button" className="sk-btn" data-size="sm" onClick={onShow}>How this works</button>;
}

/** Reads the remembered preference once the page is on the client. */
export function useHowPayWorksHidden(): [boolean, (v: boolean) => void] {
  const [hidden, setHidden] = useState(false);
  useEffect(() => { setHidden(readHidden()); }, []);
  const set = useCallback((v: boolean) => { writeHidden(v); setHidden(v); }, []);
  return [hidden, set];
}

export function HowPayWorks({ base, onHide }: { base: string; onHide: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const cur = useRef<SVGSVGElement>(null);
  const [step, setStep] = useState(0);        // 0 = storyboard, before the script takes over
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(false);
  const timer = useRef<number | null>(null);
  const typer = useRef<number | null>(null);

  const place = useCallback((at: Step['at']) => {
    const s = stage.current, c = cur.current; if (!s || !c) return;
    const r = s.getBoundingClientRect();
    if (Array.isArray(at)) { c.style.left = `${at[0]}%`; c.style.top = `${at[1]}%`; return; }
    const el = s.querySelector<HTMLElement>(`[data-hpw-id="${at}"]`); if (!el) return;
    const b = el.getBoundingClientRect();
    c.style.left = `${((b.left - r.left + b.width * 0.5) / r.width) * 100}%`;
    c.style.top = `${((b.top - r.top + b.height * 0.55) / r.height) * 100}%`;
  }, []);

  const typeIn = useCallback((n: number) => {
    const s = stage.current; if (!s) return;
    if (typer.current) window.clearInterval(typer.current);
    const els = [...s.querySelectorAll<HTMLElement>(`[data-type="${n}"]`)];
    els.forEach((e) => { e.setAttribute('data-typing', ''); e.setAttribute('data-shown', ''); e.style.setProperty('--cw', '0ch'); });
    let i = 0;
    typer.current = window.setInterval(() => {
      i += 1; let more = false;
      els.forEach((e) => {
        const t = e.dataset.full ?? e.textContent ?? ''; const k = Math.min(i, t.length);
        e.setAttribute('data-shown', t.slice(0, k)); e.style.setProperty('--cw', `${k}ch`); if (k < t.length) more = true;
      });
      if (!more && typer.current) window.clearInterval(typer.current);
    }, 70);
  }, []);

  const go = useCallback((n: number) => {
    const s = stage.current; if (!s) return;
    const st = STEPS[n - 1]; if (!st) return;
    setStep(n);
    s.dataset.step = String(n);
    s.querySelectorAll<HTMLElement>('[data-scene]').forEach((sc) => sc.toggleAttribute('data-on', sc.dataset.scene === st.tab));
    s.querySelectorAll<HTMLElement>('[data-from]').forEach((el) => {
      const on = n >= Number(el.dataset.from) && n <= Number(el.dataset.to);
      if (on) el.removeAttribute('data-hide'); else el.setAttribute('data-hide', '');
    });
    s.querySelectorAll('[data-typing],[data-lit],[data-press]').forEach((e) => { e.removeAttribute('data-typing'); e.removeAttribute('data-lit'); e.removeAttribute('data-press'); });
    s.toggleAttribute('data-tick', !!st.tick); s.toggleAttribute('data-draw', !!st.draw);
    // the run's four buttons: done, current, or not yet
    const flow: Record<string, number> = { 'hpw-start': 13, 'hpw-work': 14, 'hpw-appr': 14, 'hpw-lock': 14, 'hpw-paid': 17 };
    Object.entries(flow).forEach(([id, at]) => {
      const b = s.querySelector<HTMLElement>(`[data-hpw-id="${id}"]`); if (!b) return;
      b.removeAttribute('data-done'); b.removeAttribute('data-off');
      if (n > at || n === 17) b.setAttribute('data-done', ''); else if (n < at) b.setAttribute('data-off', '');
    });
    if (n === 14 && !reduced) {
      s.querySelector('[data-hpw-id="hpw-start"]')?.setAttribute('data-done', '');
      ['hpw-work', 'hpw-appr', 'hpw-lock'].forEach((id, i) => window.setTimeout(() => {
        if (s.dataset.step === '14') s.querySelector(`[data-hpw-id="${id}"]`)?.setAttribute('data-done', '');
      }, 600 + i * 550));
    }
    requestAnimationFrame(() => {
      place(st.at);
      if (st.type && !reduced) window.setTimeout(() => { if (s.dataset.step === String(n)) typeIn(st.type!); }, 500);
      if (st.lit) window.setTimeout(() => { if (s.dataset.step === String(n)) s.querySelector(`[data-hl="${st.lit}"]`)?.setAttribute('data-lit', ''); }, 400);
      if (st.press && !reduced) window.setTimeout(() => {
        const b = s.querySelector(`[data-hpw-id="${st.press}"]`); if (b && s.dataset.step === String(n)) { b.setAttribute('data-press', ''); window.setTimeout(() => b.removeAttribute('data-press'), 220); }
      }, 700);
    });
  }, [place, typeIn, reduced]);

  const schedule = useCallback((on: boolean) => {
    if (timer.current) window.clearTimeout(timer.current);
    if (!on) return;
    timer.current = window.setTimeout(() => {
      const s = stage.current; const n = Number(s?.dataset.step ?? 0);
      go(n >= STEPS.length ? 1 : n + 1); schedule(true);
    }, DUR);
  }, [go]);

  useEffect(() => {
    const r = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setReduced(r);
    stage.current?.setAttribute('data-live', '');
    go(1);
    setPlaying(!r); schedule(!r);
    const vis = () => { if (document.hidden) { if (timer.current) window.clearTimeout(timer.current); } else schedule(!r && !document.hidden); };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); if (timer.current) window.clearTimeout(timer.current); if (typer.current) window.clearInterval(typer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jump = (n: number) => { go(n); schedule(playing); };
  const toggle = () => { const p = !playing; setPlaying(p); schedule(p); };
  const restart = () => { go(1); setPlaying(true); schedule(true); };

  const current = STEPS[step - 1];

  return (
    <section className="sk-card sk-hpw" aria-label="How Pay works">
      <div className="sk-card-h">
        <h3>How Pay works</h3>
        <span className="flex flex-wrap items-center gap-2">
          <button type="button" className="sk-btn" data-size="sm" onClick={toggle} aria-pressed={!playing}>{playing ? 'Pause' : 'Play'}</button>
          <button type="button" className="sk-btn" data-size="sm" onClick={restart}>Restart</button>
          <button type="button" className="sk-btn" data-size="sm" onClick={onHide}>Hide</button>
        </span>
      </div>
      <div className="sk-card-b sk-hpw-walk">
        <ol className="sk-hpw-steps" aria-label="Steps">
          {GROUPS.map((g) => (
            <li key={g.title} className="sk-hpw-group">
              <span className="g">{g.title}</span>
              <ol>
                {Array.from({ length: g.to - g.from + 1 }, (_, i) => g.from + i).map((n) => (
                  <li key={n}>
                    <button type="button" onClick={() => jump(n)} aria-current={step === n ? 'step' : undefined}>{SHORT[n]}</button>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>

        <div ref={stage} className="sk-hpw-stage" data-step={step}>
          <div className="sk-hpw-tabs" role="presentation">
            {TABS.map((t) => <span key={t.key} data-on={current?.tab === t.key ? '' : undefined}>{t.label}</span>)}
          </div>

          {/* ── Settings ──────────────────────────────────────────── */}
          <div className="sk-hpw-scene" data-scene="settings">
            <div className="sk-hpw-card">
              <div className="h"><b>Where the school is</b><span className="sk-pill" data-tone="good">Saved</span></div>
              <div className="b two">
                <label><span className="lab">Country</span><div className="inp">India ▾</div></label>
                <label><span className="lab">State</span><div className="inp" data-hpw-id="hpw-region">Rajasthan ▾</div></label>
              </div>
              <div className="hint">Rules current as at 22 September 2026 · rule book IN-2026.09.22</div>
            </div>
            <div className="sk-hpw-card" data-hpw-id="hpw-access">
              <div className="h"><b>Who may see pay</b></div>
              <div className="b">
                <div className="row"><b>Srikant Misra</b><span>you · holds the salary right</span><span className="sk-pill" data-tone="good">Can see pay</span></div>
                <div className="row"><b>Meera Ansari</b><span>admin</span><span className="sk-btn" data-size="sm">Grant</span></div>
              </div>
            </div>
          </div>

          {/* ── Grades ────────────────────────────────────────────── */}
          <div className="sk-hpw-scene" data-scene="grades">
            <div className="sk-hpw-card" data-from="3" data-to="7">
              <div className="h"><b>Drafted from your roll</b><span className="sk-btn" data-variant="primary" data-size="sm">Add all 8</span></div>
              <div className="b">
                <div className="row"><b>Teacher</b><span>55 people</span><span className="inp sm" data-hpw-id="hpw-bandin" data-type="4" data-full="30000">30000</span><span className="inp sm" data-type="4" data-full="46000">46000</span></div>
                <div className="row"><b>Office</b><span>5 people</span><span className="inp sm dim">band from</span><span className="inp sm dim">to</span></div>
                <div className="row"><b>Driver</b><span>3 people</span><span className="inp sm dim">band from</span><span className="inp sm dim">to</span></div>
              </div>
            </div>
            <div className="sk-hpw-card narrow" data-from="8" data-to="8">
              <div className="b">
                <div className="h" style={{ padding: 0, border: 0 }}><b className="serif">TGT</b><span className="sk-pill" data-tone="info">0 people</span></div>
                <div className="hint">Trained Graduate Teacher</div>
                <div className="sk-payband"><i className="ink" style={{ left: '14%', right: '26%' }} /></div>
                <div className="sk-paybandends"><span>₹30,000</span><span>₹46,000</span></div>
                <div className="sk-paysplit"><span className="ink" style={{ width: '50%', background: 'var(--sk-brand)' }} /><span className="ink" style={{ width: '20%', background: '#8b83f0' }} /><span className="ink" style={{ width: '30%', background: '#ded9fb' }} /></div>
                <div className="hint">Basic 50 · House rent 20 · Special 30</div>
              </div>
            </div>
            <div className="sk-hpw-drawer" data-from="5" data-to="7">
              <div className="dh"><b>Add a grade</b><span className="sk-btn" data-size="sm">Close</span></div>
              <div className="db">
                <label><span className="lab">Name</span><div className="inp" data-hpw-id="hpw-name" data-type="5" data-full="TGT">TGT</div></label>
                <label><span className="lab">What it means</span><div className="inp" data-type="5" data-full="Trained Graduate Teacher">Trained Graduate Teacher</div></label>
                <div className="two">
                  <label><span className="lab">Band from</span><div className="inp" data-type="6" data-full="30000">30000</div></label>
                  <label><span className="lab">Band to</span><div className="inp" data-type="6" data-full="46000">46000</div></label>
                </div>
                <label><span className="lab">Basic, as a share of pay</span><div className="inp" /><span className="hint" data-hl="7">Leave it blank for the school’s own split — already 50%, already meets the law.</span></label>
              </div>
              <div className="df"><span /><span className="sk-btn" data-variant="primary" data-size="sm" data-hpw-id="hpw-add">Add grade</span></div>
            </div>
          </div>

          {/* ── People ────────────────────────────────────────────── */}
          <div className="sk-hpw-scene" data-scene="people">
            <div className="sk-hpw-card">
              <div className="h"><b>People</b><span className="hint" data-from="9" data-to="11">73 on the roll · 0 on pay</span><span className="hint" data-from="12" data-to="12">73 on the roll · 72 on pay</span></div>
              <div className="b">
                <div className="gh">
                  <b className="serif" data-from="9" data-to="11">Not on pay yet</b><b className="serif" data-from="12" data-to="12">TGT</b>
                  <span data-from="9" data-to="11">72 people · nobody can be paid until they have a figure</span><span data-from="12" data-to="12">72 people · ₹30,000 – ₹46,000 · ₹27,36,000 a month</span>
                  <span className="sk-pill" data-tone="warn" data-from="9" data-to="11">Needs you</span>
                  <span className="sk-btn" data-size="sm" data-hpw-id="hpw-sel" data-from="9" data-to="11">Select all 72</span>
                  <span className="sk-btn" data-variant="primary" data-size="sm" data-from="10" data-to="11">Put 72 on a grade</span>
                </div>
                {['Aditya Rao', 'Advait Reddy', 'Aisha Sharma', 'Amit Mehta'].map((n) => (
                  <div className="row" key={n}><i className="chk" /><b>{n}</b><span>Teacher</span><span className="amt" data-from="12" data-to="12">₹38,000</span></div>
                ))}
                <div className="more">Show 68 more</div>
              </div>
            </div>
            <div className="sk-hpw-drawer" data-from="11" data-to="11">
              <div className="dh"><b>Put 72 people on a grade</b><span className="sk-btn" data-size="sm">Close</span></div>
              <div className="db">
                <label><span className="lab">Grade</span><div className="inp">TGT — Trained Graduate Teacher ▾</div><span className="hint">Band ₹30,000 – ₹46,000. Everyone starts in the middle; change anyone who differs.</span></label>
                <label><span className="lab">From</span><div className="inp">01/10/2026</div></label>
                <div className="row"><b>Aditya Rao</b><span>Teacher</span><span className="inp sm">38000</span></div>
                <div className="row"><b>Advait Reddy</b><span>Teacher</span><span className="inp sm">38000</span></div>
                <div className="row dim"><b>… 70 more</b><span /><span className="inp sm">38000</span></div>
              </div>
              <div className="df"><span className="hint">₹27,36,000 a month</span><span className="sk-btn" data-variant="primary" data-size="sm" data-hpw-id="hpw-put2">Put 72 on TGT</span></div>
            </div>
          </div>

          {/* ── This month ────────────────────────────────────────── */}
          <div className="sk-hpw-scene" data-scene="month">
            <div className="sk-hpw-card">
              <div className="h"><b>October 2026</b><span className="sk-pill" data-tone="warn" data-from="13" data-to="13">Not run yet</span><span className="sk-pill" data-tone="info" data-from="14" data-to="16">Locked</span><span className="sk-pill" data-tone="good" data-from="17" data-to="17">Paid</span></div>
              <div className="b">
                <div className="lab">What October will cost the school</div>
                <div className="big">₹29,00,160</div>
                <div className="hint">72 people on the payroll · from the pay you have agreed</div>
                <div className="trio"><div><b>₹25,71,840</b><span>to their banks</span></div><div><b>₹1,64,160</b><span>held back</span></div><div><b>₹1,64,160</b><span>school’s own share</span></div></div>
                <div className="flow">
                  <span className="sk-btn" data-variant="primary" data-size="sm" data-hpw-id="hpw-start">Start October</span>
                  <span className="sk-btn" data-size="sm" data-hpw-id="hpw-work">Work it out</span>
                  <span className="sk-btn" data-size="sm" data-hpw-id="hpw-appr">Approve</span>
                  <span className="sk-btn" data-size="sm" data-hpw-id="hpw-lock">Lock</span>
                  <span className="sk-btn" data-size="sm" data-hpw-id="hpw-paid">Mark paid</span>
                </div>
                <div className="row" data-from="17" data-to="17"><b>October 2026</b><span>72 people · locked 2 Nov</span><span className="amt">₹29,00,160</span><span className="stamp">PAID</span></div>
              </div>
            </div>
          </div>

          {/* ── Payslips ──────────────────────────────────────────── */}
          <div className="sk-hpw-scene" data-scene="payslips">
            <div className="sk-hpw-card">
              <div className="h"><b>October 2026 · 72 payslips</b><span className="sk-btn" data-size="sm">Download all</span></div>
              <div className="b">
                {[['Aditya Rao', '₹38,000', '₹35,720'], ['Advait Reddy', '₹38,000', '₹35,720'], ['Aisha Sharma', '₹38,000', '₹35,720']].map(([n, g, net]) => (
                  <div className="row" key={n}><b>{n}</b><span>Teacher · gross {g}</span><span className="amt">{net}</span><span className="sk-btn" data-size="sm">Payslip</span></div>
                ))}
                <div className="hint">Each person sees their own under My pay — web and app — the moment the month is locked.</div>
              </div>
            </div>
          </div>

          {/* ── Filings ───────────────────────────────────────────── */}
          <div className="sk-hpw-scene" data-scene="filings">
            <div className="sk-hpw-card">
              <div className="h"><b>Filings · October 2026</b><span className="sk-pill" data-tone="good">Locked</span></div>
              <div className="b">
                <div className="row"><b>Provident fund (ECR)</b><span>due 15 Nov</span><span className="sk-btn" data-size="sm" data-hpw-id="hpw-dl">Download</span></div>
                <div className="row"><b>ESI return</b><span>due 15 Nov</span><span className="sk-btn" data-size="sm">Download</span></div>
                <div className="row"><b>Bank transfer file</b><span>72 payments · ₹25,71,840</span><span className="sk-btn" data-size="sm">Download</span></div>
                <div className="row"><b>TDS deposit</b><span>due 7 Nov</span><span className="sk-btn" data-size="sm">Download</span></div>
                <div className="hint">Sckools works out what is owed and makes the file to upload. Submitting it stays with your school and its accountant.</div>
              </div>
            </div>
          </div>

          <div className="sk-hpw-cap" aria-live="polite">{current?.c ?? 'The six screens of Pay, in the order a school meets them.'}</div>
          <svg ref={cur} className="sk-hpw-cur" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 8-6 1.5L16 20l-3 1-3-7.5L5 17z" fill="#fff" stroke="#211d45" strokeWidth="1.6" strokeLinejoin="round" /></svg>
          <div className="sk-hpw-bar"><i style={{ width: `${(step / STEPS.length) * 100}%` }} /></div>
        </div>
      </div>
      <div className="sk-card-b sk-hpw-foot" style={{ paddingTop: 0 }}>
        <p className="sk-muted" style={{ fontSize: 12.5 }}>
          Seventeen steps, then it repeats. Jump to any step from the list. Ready to start? <Link href={`${base}/settings`}>Settings</Link> first, then <Link href={`${base}/grades`}>Grades</Link>.
        </p>
      </div>
    </section>
  );
}

export { STEPS as HOW_PAY_WORKS_STEPS, TABS as HOW_PAY_WORKS_TABS };
