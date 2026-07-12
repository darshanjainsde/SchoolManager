'use client';
import './marketing.css';
import { useRef, useState } from 'react';
import type { MarketingConfigData } from '@/lib/public-api';
import CallbackModal from './CallbackModal';
import { SckoolsLogo } from '@/components/brand/sckools-logo';

const TIER_META = [
  { key: 'basic' as const, cls: 'basic', tk: 'Basic', h: 'Be found.', btn: 'btn-ghost', items: ['Public website + gallery + courses', 'Admissions pages & hall of fame', 'Enquiry inbox', 'Custom domain & SSL'] },
  { key: 'standard' as const, cls: 'std', tk: 'Standard', h: 'Be engaging.', btn: 'btn-hot', items: ['Everything in Basic', 'Events on the network feed', 'About, contact & social', 'Priority support'] },
  { key: 'pro' as const, cls: 'pro', tk: 'Pro', h: 'Be the stage.', btn: 'btn-ink', items: ['Everything in Standard', 'Host inter-school events + sponsor matching', 'Full management suite', 'Custom feature support'] },
];

export default function PricingCards({ config }: { config: MarketingConfigData }) {
  const [inr, setInr] = useState(false);
  const [modalInterest, setModalInterest] = useState<string | null | false>(false);
  const [flipKey, setFlipKey] = useState(0);
  const priceRefs = useRef<Array<HTMLSpanElement | null>>([]);

  function toggle() {
    // Replay the flip animation, swap the number mid-flip (mirrors the mockup).
    setFlipKey((k) => k + 1);
    setTimeout(() => setInr((v) => !v), 200);
  }

  return (
    <div className="mkt">
      <nav className="mnav" aria-label="Main">
        <div className="mnav-in">
          <a href="/" className="logo"><SckoolsLogo size={32} /></a>
          <a className="lnk" href="/#feats">Features</a>
          <a className="lnk" href="/#events">Events Network</a>
          <a className="lnk" href="/#switch">Why switch</a>
          <button className="btn btn-hot btn-sm" onClick={() => setModalInterest(null)}>Request a callback</button>
        </div>
      </nav>

      <div className="p-head wrap">
        <span className="eyebrow">Plans &amp; pricing</span>
        <h1 className="h-lg">Simple plans. Serious growth.</h1>
        <p className="lede" style={{ margin: '14px auto 0' }}>
          Every plan is a full school website with its own domain — pick how far you want the stage to reach.
        </p>
        <button className="cur-toggle" onClick={toggle} title="Click to switch currency">
          <span className="cur">{inr ? 'INR ₹' : 'USD $'}</span>
          <small>click to switch to {inr ? '$ USD' : '₹ INR'}</small>
        </button>
      </div>

      <div className="wrap">
        <div className="grid ladder" style={{ alignItems: 'stretch', paddingBottom: 40 }}>
          {TIER_META.map((t, i) => {
            const p = config.prices[t.key];
            return (
              <div className={`tier ${t.cls}`} key={t.tk}>
                <span className="tk">{t.tk}</span>
                <h3>{t.h}</h3>
                <div>
                  <span
                    className={`price ${flipKey ? 'flip' : ''}`}
                    key={`${t.key}-${flipKey}`}
                    ref={(el) => { priceRefs.current[i] = el; }}
                  >
                    {inr ? `₹${p.inr.toLocaleString('en-IN')}` : `$${p.usd}`}
                  </span>
                  <span className="per"> /month</span>
                </div>
                <ul>{t.items.map((it) => <li key={it}>{it}</li>)}</ul>
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
