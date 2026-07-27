'use client';
import './marketing.css';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { MarketingConfigData } from '@/lib/public-api';
import {
  BILLED_CURRENCIES,
  CURRENCIES,
  convertFromUsd,
  formatMoney,
  isSupportedCurrency,
  type Rates,
} from '@/lib/fx';
import CallbackModal from './CallbackModal';
import { SckoolsLogo } from '@/components/brand/sckools-logo';

const STORE_KEY = 'sckools:currency';
const BILLED = new Set<string>(BILLED_CURRENCIES);
const CONVERTED = CURRENCIES.filter((c) => !BILLED.has(c.code));

/** Long amounts (₹1,00,000 · Rp 1,600,000) step down so "/year" stays on the line. */
function sizeClass(amount: string): string {
  if (amount.length <= 6) return '';
  if (amount.length <= 9) return 'p-sm';
  if (amount.length <= 12) return 'p-xs';
  return 'p-xxs';
}

const TIER_META = [
  {
    key: 'basic' as const, cls: 'basic', tk: 'Basic', h: 'Be found.', btn: 'btn-ghost', inherit: null,
    groups: [
      { g: 'Your website', items: ['Complete school site — home, courses, gallery, admissions & hall of fame', 'Flip-card course explorer parents love', 'Photo & video gallery, lightning fast', 'Mobile-perfect, SEO-ready pages'] },
      { g: 'Admissions engine', items: ['Enquiry inbox — every lead captured, tracked & statused', 'Admissions process & fee structure pages'] },
      { g: 'Included forever', items: ['Your own domain, SSL & hosting', 'Monthly platform updates — free'] },
    ],
  },
  {
    key: 'standard' as const, cls: 'std', tk: 'Standard', h: 'Be engaging.', btn: 'btn-hot', inherit: 'Everything in Basic, plus',
    groups: [
      { g: 'Network reach', items: ['Your events published to the shared network feed — seen by every Sckools school', 'Students join inter-school events across the network'] },
      { g: 'Community', items: ['About, contact & social presence pages', 'Announcements to parents & students'] },
      { g: 'Care', items: ['Priority support — real humans, fast'] },
    ],
  },
  {
    key: 'pro' as const, cls: 'pro', tk: 'Pro', h: 'Be the stage.', btn: 'btn-ink', inherit: 'Everything in Standard, plus',
    groups: [
      { g: 'The stage', items: ['Host paid inter-school events — entry passes, bigger crowds', 'Sponsor matchmaking — we pitch brands to back your events'] },
      { g: 'Management suite', items: ['Students, classes, teachers & staff records', 'Timetables, attendance & teacher availability', 'Assignments & announcements', 'Teacher & student portals'] },
      { g: 'Partnership', items: ['Custom features built for your school', 'Dedicated onboarding — we set everything up'] },
    ],
  },
];

export default function PricingCards({
  config,
  rates,
  initialCurrency = 'USD',
}: {
  config: MarketingConfigData;
  rates: Rates;
  initialCurrency?: string;
}) {
  // `selected` follows the picker instantly; `currency` (what the cards show)
  // lags by the flip animation, so the number changes mid-flip.
  const [selected, setSelected] = useState(initialCurrency);
  const [currency, setCurrency] = useState(initialCurrency);
  const [modalInterest, setModalInterest] = useState<string | null | false>(false);
  const [flipKey, setFlipKey] = useState(0);
  const priceRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const billed = BILLED.has(currency);

  // A visitor's own pick beats the geo guess on every later visit. Applied
  // after mount so the server and first client paint still agree.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORE_KEY);
      if (saved && isSupportedCurrency(saved)) {
        setSelected(saved);
        setCurrency(saved);
      }
    } catch {
      /* private mode — geo default is fine */
    }
  }, []);

  useEffect(() => () => { if (swapTimer.current) clearTimeout(swapTimer.current); }, []);

  function pick(code: string) {
    if (code === selected) return;
    setSelected(code);
    try {
      window.localStorage.setItem(STORE_KEY, code);
    } catch {
      /* nothing to do — the choice just won't persist */
    }
    // Replay the flip animation, swap the number mid-flip (mirrors the mockup).
    setFlipKey((k) => k + 1);
    if (swapTimer.current) clearTimeout(swapTimer.current);
    swapTimer.current = setTimeout(() => setCurrency(code), 200);
  }

  /** Billed currencies come straight from the owner console; the rest are FX. */
  function priceFor(tier: 'basic' | 'standard' | 'pro') {
    const p = config.prices[tier];
    if (currency === 'INR') return formatMoney(p.inr, 'INR');
    if (currency === 'USD') return formatMoney(p.usd, 'USD');
    return formatMoney(convertFromUsd(p.usd, currency, rates), currency);
  }

  return (
    <div className="mkt">
      <nav className="mnav" aria-label="Main">
        <div className="mnav-in">
          <Link href="/" className="logo"><SckoolsLogo size={32} /></Link>
          <Link className="lnk" href="/#feats">Features</Link>
          <Link className="lnk" href="/#events">Events Network</Link>
          <Link className="lnk" href="/#switch">Why switch</Link>
          <Link className="lnk" href="/blog">Blog</Link>
          <button className="btn btn-hot btn-sm" onClick={() => setModalInterest(null)}>Request a callback</button>
        </div>
      </nav>

      <div className="p-head wrap">
        <span className="eyebrow">Plans &amp; pricing</span>
        <h1 className="h-lg">Simple plans. Serious growth.</h1>
        <p className="lede" style={{ margin: '14px auto 0' }}>
          Every plan is a full school website with its own domain — pick how far you want the stage to reach.
        </p>
        <div className="cur-pick">
          <label htmlFor="cur-select">Show prices in</label>
          <div className="cur-field">
            <select
              id="cur-select"
              value={selected}
              onChange={(e) => pick(e.target.value)}
              aria-describedby="cur-note"
            >
              <optgroup label="Billed currencies">
                <option value="INR">₹ INR — Indian Rupee</option>
                <option value="USD">$ USD — US Dollar</option>
              </optgroup>
              <optgroup label="Approximate, converted from USD">
                {CONVERTED.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                ))}
              </optgroup>
            </select>
            <span className="cur-caret" aria-hidden="true">▾</span>
          </div>
          <p className="cur-note" id="cur-note">
            {billed
              ? 'Billed once a year — in ₹ INR for schools in India, $ USD everywhere else.'
              : `Approximate — converted from USD at today's exchange rate. You are billed in $ USD.`}
          </p>
        </div>
      </div>

      <div className="wrap">
        <div className="grid ladder" style={{ alignItems: 'stretch', paddingBottom: 40 }}>
          {TIER_META.map((t, i) => {
            const amount = priceFor(t.key);
            return (
              <div className={`tier ${t.cls}`} key={t.tk}>
                <span className="tk">{t.tk}</span>
                <h3>{t.h}</h3>
                <div className="price-row">
                  {!billed && <span className="approx" aria-hidden="true">≈</span>}
                  <span
                    className={`price ${sizeClass(amount)} ${flipKey ? 'flip' : ''}`}
                    key={`${t.key}-${flipKey}`}
                    ref={(el) => { priceRefs.current[i] = el; }}
                  >
                    {amount}
                  </span>
                  <span className="per">/year</span>
                </div>
                {t.inherit && <span className="inherit" style={{ marginTop: 14 }}>↑ {t.inherit}</span>}
                <div className="tfeats">
                  {t.groups.map((gr) => (
                    <div key={gr.g}>
                      <div className="grp">{gr.g}</div>
                      <ul>{gr.items.map((it) => <li key={it}>{it}</li>)}</ul>
                    </div>
                  ))}
                </div>
                <button className={`btn ${t.btn} btn-sm`} onClick={() => setModalInterest(t.tk)}>Request a callback</button>
              </div>
            );
          })}
        </div>
        <p className="p-note">💡 All plans include <b>2 months of custom feature support</b> at onboarding and frequent platform updates, free.</p>
        <div style={{ height: 70 }} />
      </div>

      {modalInterest !== false && <CallbackModal interest={modalInterest} onClose={() => setModalInterest(false)} />}
    </div>
  );
}
