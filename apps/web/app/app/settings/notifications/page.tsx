'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SettingsCard, SettingsSection } from '../section';
import { EmailSettings, emailMonth, emailOn, useEmailSettings } from './email-settings';
import { WhatsAppSettings, useWhatsAppSettings, whatsAppMonth, whatsAppState } from './whatsapp-settings';

/**
 * Settings → Notifications (settings audit, 11 Oct 2026). Everything about how
 * the school reaches people, out of the school-calendar page it was mixed into.
 * Three parts: an overview of the channels, Email, and WhatsApp & phone.
 * Delivery logs open behind a button; they never sit on the page.
 */
const PARTS = [
  { key: 'overview', label: 'Overview' },
  { key: 'email', label: 'Email' },
  { key: 'whatsapp', label: 'WhatsApp & phone' },
] as const;
type Part = (typeof PARTS)[number]['key'];

export default function NotificationsSettingsPage() {
  const [part, setPart] = useState<Part>('overview');

  // A link to #email or #whatsapp opens that part.
  useEffect(() => {
    const h = window.location.hash.replace('#', '');
    if (PARTS.some((p) => p.key === h)) setPart(h as Part);
  }, []);
  function go(p: Part) {
    setPart(p);
    window.history.replaceState(null, '', p === 'overview' ? window.location.pathname : `#${p}`);
  }

  return (
    <div data-testid="notifications-settings">
      <div className="sk-setchips" role="tablist" aria-label="Notifications" style={{ marginBottom: 8 }}>
        {PARTS.map((p) => (
          <button key={p.key} type="button" role="tab" aria-selected={part === p.key} className="sk-btn"
            data-variant={part === p.key ? 'primary' : undefined} onClick={() => go(p.key)} data-testid={`notif-part-${p.key}`}>
            {p.label}
          </button>
        ))}
      </div>
      {part === 'overview' ? <Overview onOpen={go} /> : null}
      {part === 'email' ? <EmailSettings /> : null}
      {part === 'whatsapp' ? <WhatsAppSettings /> : null}
    </div>
  );
}

function Overview({ onOpen }: { onOpen: (p: Part) => void }) {
  const email = useEmailSettings().q;
  const wa = useWhatsAppSettings().q;
  const em = emailMonth(email.data);
  const wm = whatsAppMonth(wa.data);
  const ws = whatsAppState(wa.data);
  const dash = '–';

  return (
    <>
      <SettingsSection title="Channels" hint="How messages reach families and staff, and how this month went." testId="notif-channels">
        <div className="sk-chans">
          <div className="sk-chan" data-testid="chan-app">
            <div className="hd"><b>App</b><span className="sk-pill" data-tone="good">Always on</span></div>
            <span className="v">All</span>
            <span className="h">Every school message appears in the Sckools app and its bell.</span>
          </div>
          <div className="sk-chan" data-testid="chan-whatsapp">
            <div className="hd"><b>WhatsApp</b>{wa.data ? <span className="sk-pill" data-tone={ws.tone}>{ws.on ? (ws.live ? 'On' : 'Waiting') : 'Off'}</span> : null}</div>
            <span className="v">{wa.data ? wm.sent : dash}</span>
            <span className="h">{wa.isError ? 'Could not load' : wa.data ? `sent this month${wm.failed ? ` · ${wm.failed} failed` : ''}` : 'Loading…'}</span>
            <button type="button" className="sk-btn go" data-size="sm" onClick={() => onOpen('whatsapp')}>Manage</button>
          </div>
          <div className="sk-chan" data-testid="chan-email">
            <div className="hd"><b>Email</b>{email.data ? <span className="sk-pill" data-tone={emailOn(email.data) ? 'good' : 'neutral'} data-testid="chan-email-state">{emailOn(email.data) ? 'On' : 'Off'}</span> : null}</div>
            <span className="v">{email.data ? em.total : dash}</span>
            <span className="h">{email.isError ? 'Could not load' : email.data ? `sent this month${em.bad ? ` · ${em.bad} not delivered` : ''}` : 'Loading…'}</span>
            <button type="button" className="sk-btn go" data-size="sm" onClick={() => onOpen('email')}>Manage</button>
          </div>
          <div className="sk-chan" data-testid="chan-sms">
            <div className="hd"><b>SMS</b><span className="sk-pill" data-tone="neutral">Codes only</span></div>
            <span className="v">{dash}</span>
            <span className="h">Used only for sign-in codes.</span>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="How a message travels" hint="The same rules for every school message." testId="notif-rules">
        <SettingsCard>
          <ul className="sk-setrules">
            <li><b>App:</b> every message, for everyone signed in to the Sckools app.</li>
            <li><b>WhatsApp:</b> also sent when WhatsApp is on here and the person has a verified number.</li>
            <li><b>Email:</b> also sent when Email is on here, for messages that have an email version, when an address is on file.</li>
          </ul>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Your own alerts" hint="What reaches you personally is set on your profile." testId="notif-own">
        <SettingsCard>
          <div className="sk-setline">
            <span className="txt">Leave requests, registers, fees, enquiries and the daily summary on WhatsApp.</span>
            <Link href="/app/profile" className="sk-btn">Open My profile</Link>
          </div>
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
