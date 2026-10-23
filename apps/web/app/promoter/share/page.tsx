'use client';
import { toast } from 'sonner';
import { Failed, Loading } from '@/components/promoter/bits';
import { usePromoterMe } from '@/components/promoter/use-me';

function CopyBlock({ text, label }: { text: string; label: string }) {
  async function copy() {
    try { await navigator.clipboard.writeText(text); toast.success('Copied.'); } catch { toast.error('Select the text and copy it.'); }
  }
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'var(--sk-bg-2)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5 }}>
      <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{text}</span>
      <button className="sk-btn" onClick={copy} aria-label={`Copy ${label}`} style={{ flex: 'none' }}>Copy</button>
    </div>
  );
}

export default function PromoterShare() {
  const me = usePromoterMe();
  if (me.isLoading) return <Loading what="your link" />;
  if (me.isError || !me.data) return <Failed error={me.error} onRetry={() => me.refetch()} />;
  const code = me.data.code;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://sckools.com';
  const link = `${origin}/start?ref=${code}`;
  const msgs = [
    ['To a principal', `Sir/Madam, I came across Sckools: a school website, admin software and a parent app on one login, priced per student. They do a 30-minute demo on your own school. Shall I ask them to call you? Here is the page: ${link}`],
    ['To a PTA group', `Parents, I have been looking at Sckools for our school: attendance alerts by 8:15, diary and homework on the phone, fees online. If the school would like a demo: ${link}`],
    ['To a school owner', `A quick one: Sckools runs the office, the teachers and the parents on one system, per student per year, with the website included. Worth a 30-minute look. ${link}`],
  ];
  return (
    <>
      <header className="sk-pagehead"><h1>Share</h1><p>A link that credits you, and messages you can send as they are.</p></header>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)', gap: 14, alignItems: 'start' }} className="pr-two">
        <div className="sk-card">
          <div className="sk-card-h"><h3>Your link</h3><p className="sk-muted">A school that asks for a quote from this link is attributed to you for {me.data.attributionDays} days, without you logging anything.</p></div>
          <div className="sk-card-b">
            <CopyBlock text={link} label="your link" />
            <p className="sk-muted" style={{ margin: 0 }}>Your code is <b>{code}</b>. Logging a school yourself still works the same; the link is for sharing.</p>
          </div>
        </div>
        <div className="sk-card">
          <div className="sk-card-h"><h3>WhatsApp messages</h3><p className="sk-muted">Our words, our promises. Change the greeting, keep the rest.</p></div>
          <div className="sk-card-b">
            {msgs.map(([t, m]) => <div key={t}><span className="sk-lab">{t}</span><div style={{ marginTop: 4 }}><CopyBlock text={m} label={t} /></div></div>)}
          </div>
        </div>
      </div>
      <style>{`@media (max-width: 860px) { .pr-two { grid-template-columns: 1fr !important; } }`}</style>
    </>
  );
}
