import { ArtFrame, Bokeh, Bulbs, Diya, Fall, Kandil, Rangoli, Samai, Stars, Toran } from './primitives';
import type { SceneProps } from './scene-types';

/* ── DIWALI ────────────────────────────────────────────────────────────── */
export function DiwaliScene({ variant, imageUrl, night }: SceneProps) {
  switch (variant) {
    case 'LAKSHMI':
      return (
        <>
          <Bokeh strength={night ? 1 : 0.8} />
          <ArtFrame src={imageUrl ?? '/festive/art/lakshmi.webp'} alt="Goddess Lakshmi" credit={imageUrl ? undefined : 'Ravi Varma, 1894'} className="ps-fest-art" />
          <div className="ps-fest-floor"><Diya x={8} y={0} size={0.7} /><Diya x={64} y={6} size={0.55} delay={0.5} /><Diya x={110} y={2} size={0.65} delay={0.9} /></div>
        </>
      );
    case 'LANTERNS':
      return (
        <>
          <Bokeh />
          <Bulbs width={1600} fit="slice" className="ps-fest-top" />
          <div className="ps-fest-hang"><Kandil x={0} y={0} color="#c8402f" /><Kandil x={54} y={10} color="#e8862a" delay={0.7} size={0.85} /><Kandil x={100} y={4} color="#1f5fa8" delay={1.3} size={0.9} /></div>
          <div className="ps-fest-floor"><Diya x={0} y={4} size={0.6} /><Diya x={52} y={0} size={0.75} delay={0.6} /></div>
        </>
      );
    case 'RANGOLI':
      return (
        <>
          <Bokeh strength={0.7} />
          <div className="ps-fest-corner"><Rangoli size={1.1} x={40} y={40} /><Samai x={-10} y={-80} size={0.9} /></div>
        </>
      );
    default: // DEEPAVALI — the courtyard: rangoli with diyas set on its ring, a toran, lanterns
      return (
        <>
          <Bokeh />
          <Toran width={1600} fit="slice" className="ps-fest-top" />
          <div className="ps-fest-corner">
            <Rangoli x={70} y={60} />
            <Diya x={50} y={62} size={0.5} /><Diya x={92} y={30} size={0.5} delay={0.4} /><Diya x={150} y={22} size={0.55} delay={0.8} /><Diya x={200} y={48} size={0.5} delay={1.2} />
          </div>
          <div className="ps-fest-floor"><Diya x={4} y={0} size={0.8} /><Diya x={70} y={6} size={0.6} delay={0.5} /></div>
        </>
      );
  }
}

/* ── EID ───────────────────────────────────────────────────────────────── */
function Crescent({ x = 0, y = 0, size = 1 }: { x?: number; y?: number; size?: number }) {
  return (
    <svg viewBox="0 0 80 80" width={80} height={80} style={{ position: 'absolute', left: x, top: y, scale: String(size), transformOrigin: '0 0' }} aria-hidden="true">
      <circle className="ps-fx-glow" cx="40" cy="40" r="38" fill="#e6c26a" opacity=".18" />
      <path d="M52 8a32 32 0 1 0 20 52 26 26 0 1 1-20-52z" fill="#e6c26a" stroke="#b8862b" strokeWidth="1.5" />
    </svg>
  );
}
function Fanoos({ x = 0, y = 0, size = 1, delay = 0 }: { x?: number; y?: number; size?: number; delay?: number }) {
  return (
    <svg viewBox="0 0 30 70" width={30} height={70} className="ps-fx-swing" style={{ position: 'absolute', left: x, top: y, scale: String(size), transformOrigin: '50% 0', animationDelay: `${delay}s` }} aria-hidden="true">
      <path d="M15 0v10" stroke="#e6c26a" strokeWidth="1.4" />
      <path d="M7 10h16l-2 5H9z" fill="#e6c26a" /><path d="M6 15h18v26l-9 8-9-8z" fill="#c9a24a" />
      <rect x="9" y="19" width="12" height="18" rx="2" fill="#fff4c2" opacity=".9" className="ps-fx-twinkle" />
      <path d="M11 49h8l-4 7z" fill="#e6c26a" />
    </svg>
  );
}
function Skyline({ color = '#0b1f1c' }: { color?: string }) {
  return (
    <svg className="ps-fest-skyline" viewBox="0 0 380 60" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 60V40h30v-8l6-6 6 6v8h20V30l10-14 10 14v10h18v-6h8v6h20V26l12-10 12 10v14h22V22a14 14 0 0 1 28 0v18h18v-8h8v8h26V32l8-8 8 8v8h36V28l10-12 10 12v12h44v20z" fill={color} stroke="#c9a24a" strokeWidth=".6" strokeOpacity=".5" />
      {/* lit windows */}
      {[40, 78, 130, 178, 214, 262, 300, 350].map((x, i) => <rect key={x} x={x} y={44 + (i % 2) * 4} width="3" height="4" fill="#ffe08a" className="ps-fx-twinkle" style={{ animationDelay: `${i * 0.3}s` }} />)}
    </svg>
  );
}
export function EidScene({ variant, night }: SceneProps) {
  switch (variant) {
    case 'LANTERNS':
      return (<><Stars count={20} night={night} /><div className="ps-fest-hang"><Fanoos x={0} /><Fanoos x={40} y={12} size={0.8} delay={0.8} /><Fanoos x={74} y={2} size={0.9} delay={1.4} /></div><Crescent x={-30} y={-24} size={0.7} /></>);
    case 'SKYLINE':
      return (<><Stars count={30} night={night} /><Crescent x={20} y={10} size={0.9} /><Skyline color={night ? '#173d33' : '#0b1f1c'} /></>);
    default: // CHAAND — the moon of Chaand Raat
      return (<><Stars count={26} night={night} /><div className="ps-fest-corner"><Crescent x={110} y={20} size={1.5} /></div><Bokeh strength={0.5} color="#e6c26a" /></>);
  }
}

/* ── CHRISTMAS ─────────────────────────────────────────────────────────── */
function Tree({ x = 0, y = 0, size = 1 }: { x?: number; y?: number; size?: number }) {
  const lights = [[40, 62, '#ff5252'], [58, 76, '#ffd740'], [30, 92, '#40c4ff'], [66, 104, '#ff5252'], [44, 118, '#69f0ae'], [72, 132, '#ffd740'], [28, 138, '#ff5252'], [52, 148, '#40c4ff']] as const;
  return (
    <svg viewBox="0 0 100 180" width={100} height={180} style={{ position: 'absolute', left: x, top: y, scale: String(size), transformOrigin: '0 100%' }} aria-hidden="true">
      <rect x="44" y="150" width="12" height="22" fill="#6b4a2a" />
      <path d="M50 30L18 90h64z" fill="#1f7a3d" /><path d="M50 60L12 128h76z" fill="#2a8a48" /><path d="M50 92L6 158h88z" fill="#1f7a3d" />
      <path d="M50 8l4.5 11 12 1-9 8 2.8 12L50 34l-10.3 6 2.8-12-9-8 12-1z" fill="#ffd740" className="ps-fx-twinkle" />
      {lights.map(([cx, cy, c], i) => <circle key={i} cx={cx} cy={cy} r="3.2" fill={c} className="ps-fx-blink" style={{ animationDelay: `${i * 0.3}s` }} />)}
      <g><rect x="8" y="160" width="22" height="16" rx="2" fill="#c8402f" /><rect x="17" y="160" width="4" height="16" fill="#ffd740" /><rect x="70" y="158" width="20" height="18" rx="2" fill="#1f5fa8" /><rect x="70" y="165" width="20" height="4" fill="#ffd740" /></g>
    </svg>
  );
}
export function ChristmasScene({ variant }: SceneProps) {
  switch (variant) {
    case 'LIGHTS':
      return (<><Bulbs width={1600} color="#2a5a3a" fit="slice" className="ps-fest-top" /><Fall count={14} className="ps-fest-snow" render={() => <i className="ps-fest-flake" />} /></>);
    case 'GIFTS':
      return (<><Fall count={10} render={(i) => <svg viewBox="0 0 24 24" width="22" height="22"><rect x="2" y="8" width="20" height="14" rx="2" fill={['#c8402f', '#1f5fa8', '#1f7a3d'][i % 3]} /><rect x="10" y="8" width="4" height="14" fill="#ffd740" /><rect x="2" y="8" width="20" height="4" fill="#ffd740" opacity=".6" /></svg>} /><Fall count={8} className="ps-fest-snow" render={() => <i className="ps-fest-flake" />} /></>);
    default: // TREE
      return (<><Fall count={10} className="ps-fest-snow" render={() => <i className="ps-fest-flake" />} /><div className="ps-fest-corner"><Tree x={90} y={20} /></div></>);
  }
}

/* ── NEW YEAR ──────────────────────────────────────────────────────────── */
function Burst({ x, y, delay = 0, color = '#ffd27a' }: { x: string; y: string; delay?: number; color?: string }) {
  return <span className="ps-fx-burst" style={{ left: x, top: y, animationDelay: `${delay}s`, background: `repeating-conic-gradient(${color} 0 3deg, transparent 3deg 22deg)` }} aria-hidden="true" />;
}
export function NewYearScene({ variant, night }: SceneProps) {
  switch (variant) {
    case 'SPARKLE':
      return (<><Stars count={30} night={night} /><Fall count={12} render={() => <i className="ps-fest-spark" />} /></>);
    default: // FIREWORKS
      return (<><Stars count={20} night={night} /><Burst x="70%" y="14%" /><Burst x="86%" y="30%" delay={1.1} color="#ff9fd0" /><Burst x="58%" y="34%" delay={2.1} color="#9fe0ff" /></>);
  }
}

/* ── JANMASHTAMI ───────────────────────────────────────────────────────── */
function Matki({ x = 0, y = 0 }: { x?: number; y?: number }) {
  return (
    <svg viewBox="0 0 120 160" width={120} height={160} style={{ position: 'absolute', left: x, top: y }} aria-hidden="true">
      <path d="M60 0v40" stroke="#7a5a2a" strokeWidth="2" />
      <g className="ps-fx-pendulum" style={{ transformOrigin: '60px 0' }}>
        <path d="M60 0v40" stroke="#7a5a2a" strokeWidth="2" />
        <path d="M34 42q-4 30 26 40q30-10 26-40z" fill="#b8663a" /><path d="M30 42q30-10 60 0q-30 8-60 0z" fill="#8a4a26" />
        <ellipse cx="60" cy="43" rx="22" ry="5" fill="#fff8e6" /><circle cx="52" cy="40" r="4" fill="#fff" /><circle cx="66" cy="39" r="3" fill="#fff" />
        <path d="M40 60q20 8 40 0" stroke="#e8952e" strokeWidth="3" fill="none" /><circle cx="46" cy="70" r="3" fill="#c8402f" /><circle cx="60" cy="74" r="3" fill="#ffd740" /><circle cx="74" cy="70" r="3" fill="#c8402f" />
      </g>
    </svg>
  );
}
function Feather({ x = 0, y = 0, size = 1 }: { x?: number; y?: number; size?: number }) {
  return (
    <svg viewBox="0 0 60 140" width={60} height={140} className="ps-fx-sway" style={{ position: 'absolute', left: x, top: y, scale: String(size), transformOrigin: '50% 100%' }} aria-hidden="true">
      <path d="M30 140Q28 90 30 40" stroke="#5a7a2a" strokeWidth="2" fill="none" />
      <path d="M30 50c-14 10-22 30-16 52 8 4 14-4 16-12 2 8 8 16 16 12 6-22-2-42-16-52z" fill="#2e9d6b" />
      <path d="M30 22c-10 6-16 18-12 32 6 2 10-2 12-8 2 6 6 10 12 8 4-14-2-26-12-32z" fill="#1f5fa8" />
      <ellipse cx="30" cy="30" rx="7" ry="10" fill="#0e2b4a" /><ellipse cx="30" cy="31" rx="4" ry="6" fill="#2fa36b" /><circle cx="30" cy="30" r="2.2" fill="#ffd740" />
    </svg>
  );
}
export function JanmashtamiScene({ variant, imageUrl, night }: SceneProps) {
  switch (variant) {
    case 'KRISHNA':
      return (<><Bokeh strength={night ? 0.9 : 0.6} color="#7fc8ff" /><ArtFrame src={imageUrl ?? '/festive/art/krishna.webp'} alt="Venugopal Krishna" credit={imageUrl ? undefined : 'Ravi Varma Press'} className="ps-fest-art" /><Feather x={-30} y={20} size={0.7} /></>);
    case 'FEATHER':
      return (<><Bokeh strength={0.5} color="#7fc8ff" /><div className="ps-fest-corner"><Feather x={120} y={20} size={1.1} /><Feather x={70} y={60} size={0.7} /></div></>);
    default: // MATKI — the dahi handi
      return (<><Bokeh strength={0.5} color="#7fc8ff" /><div className="ps-fest-hang"><Matki x={30} y={0} /><Feather x={-30} y={70} size={0.75} /></div></>);
  }
}

/* ── LOHRI & BIHU ──────────────────────────────────────────────────────── */
function Bonfire({ x = 0, y = 0 }: { x?: number; y?: number }) {
  return (
    <svg viewBox="0 0 120 120" width={120} height={120} style={{ position: 'absolute', left: x, top: y }} aria-hidden="true">
      <circle className="ps-fx-glow" cx="60" cy="70" r="50" fill="#ff9d3a" opacity=".2" />
      <g className="ps-fx-burn" style={{ transformOrigin: '60px 100px' }}>
        <path d="M60 20c14 20 30 34 22 58-6 18-38 18-44 0-8-24 8-38 22-58z" fill="#ff7a2a" />
        <path d="M60 46c8 12 16 20 12 34-4 10-20 10-24 0-4-14 4-22 12-34z" fill="#ffc14a" />
      </g>
      <path d="M20 104l80-10M22 94l78 10" stroke="#6b4a2a" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}
export function LohriScene({ variant }: SceneProps) {
  switch (variant) {
    case 'KITES': return <KiteSky />;
    default: return (<><Bokeh strength={0.7} color="#ff9d3a" /><div className="ps-fest-corner"><Bonfire x={100} y={70} /></div><Fall count={8} render={() => <i className="ps-fest-spark" />} /></>);
  }
}

/* ── GURU NANAK JAYANTI ────────────────────────────────────────────────── */
export function GuruNanakScene({ variant }: SceneProps) {
  switch (variant) {
    case 'LIGHTS': return (<><Bokeh color="#f2a93b" /><Bulbs width={1600} color="#8a6a2a" fit="slice" className="ps-fest-top" /></>);
    default: return (<><Bokeh color="#f2a93b" /><div className="ps-fest-floor"><Diya x={0} y={0} size={0.7} /><Diya x={46} y={6} size={0.6} delay={0.4} /><Diya x={88} y={2} size={0.7} delay={0.8} /><Diya x={136} y={8} size={0.55} delay={1.2} /></div></>);
  }
}

/* shared: kites */
export function KiteSky() {
  const kites = [['#c8402f', 0], ['#1f5fa8', 5], ['#e8862a', 10], ['#2e9d6b', 15]] as const;
  return (
    <>
      {kites.map(([c, d], i) => (
        <svg key={i} className="ps-fx-kite" viewBox="0 0 40 60" width="40" height="60" style={{ animationDelay: `${d}s`, top: `${20 + i * 12}%` }} aria-hidden="true">
          <path d="M20 0L40 22 20 44 0 22z" fill={c} /><path d="M20 0v44M0 22h40" stroke="#fff" strokeWidth="1" opacity=".6" />
          <path d="M20 44q6 8 0 16" stroke={c} strokeWidth="1.5" fill="none" />
        </svg>
      ))}
    </>
  );
}
