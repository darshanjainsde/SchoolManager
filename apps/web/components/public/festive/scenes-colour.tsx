import { ArtFrame, Bokeh, Diya, Fall, Rangoli, Toran } from './primitives';
import { KiteSky } from './scenes-lights';
import type { SceneProps } from './scene-types';

/* ── HOLI ──────────────────────────────────────────────────────────────── */
const GULAL = ['#e91e8c', '#ffc107', '#26c281', '#2196f3', '#ff5722', '#9c27b0'];
function Pichkari({ x = 0, y = 0, color = '#e91e8c' }: { x?: number; y?: number; color?: string }) {
  return (
    <svg viewBox="0 0 160 90" width={160} height={90} style={{ position: 'absolute', left: x, top: y }} aria-hidden="true">
      {/* the spray: droplets on fixed arcs, each on its own phase */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle key={i} className="ps-fx-spray" cx={92 + i * 4} cy={38 - i * 2} r={3 - i * 0.3} fill={color} style={{ animationDelay: `${i * 0.18}s`, ['--dx' as string]: `${40 + i * 12}px`, ['--dy' as string]: `${-30 + i * 9}px` }} />
      ))}
      <rect x="10" y="30" width="70" height="20" rx="8" fill={color} /><rect x="0" y="34" width="14" height="12" rx="3" fill="#333" />
      <rect x="78" y="35" width="16" height="10" rx="3" fill="#ffd740" /><rect x="30" y="50" width="12" height="26" rx="4" fill="#333" />
      <rect x="20" y="26" width="14" height="28" rx="4" fill="#fff" opacity=".35" />
    </svg>
  );
}
function Splash({ x, y, color, size = 1 }: { x: string; y: string; color: string; size?: number }) {
  return (
    <svg className="ps-fx-drift" viewBox="0 0 100 100" width={100 * size} height={100 * size} style={{ position: 'absolute', left: x, top: y }} aria-hidden="true">
      <path d="M50 8c12 6 22 2 30 12s2 22 10 30-2 22-12 28-24 4-30 12-22 2-30-8-6-22-12-30 4-22 12-30 20-8 32-14z" fill={color} opacity=".85" />
      <circle cx="82" cy="30" r="5" fill={color} /><circle cx="18" cy="76" r="4" fill={color} /><circle cx="70" cy="86" r="3" fill={color} />
    </svg>
  );
}
export function HoliScene({ variant }: SceneProps) {
  switch (variant) {
    case 'BALLOONS':
      return <Fall count={12} render={(i) => <svg viewBox="0 0 24 30" width="20" height="26"><ellipse cx="12" cy="14" rx="10" ry="13" fill={GULAL[i % GULAL.length]} /><path d="M9 26h6l-3 4z" fill={GULAL[i % GULAL.length]} /><ellipse cx="8" cy="9" rx="3" ry="5" fill="#fff" opacity=".35" /></svg>} />;
    case 'GULAL':
      return (<><Splash x="70%" y="-10%" color="#e91e8c" size={1.6} /><Splash x="86%" y="40%" color="#ffc107" size={1.2} /><Splash x="-6%" y="60%" color="#26c281" size={1.3} /><Splash x="60%" y="70%" color="#2196f3" size={0.9} /></>);
    default: // SPLASH — pichkaris firing colour across the corner
      return (<><Splash x="78%" y="-8%" color="#e91e8c" size={1.4} /><Splash x="88%" y="46%" color="#2196f3" size={1} /><div className="ps-fest-corner"><Pichkari x={30} y={70} color="#e91e8c" /><Pichkari x={110} y={120} color="#26c281" /></div></>);
  }
}

/* ── NAVRATRI & DUSSEHRA ───────────────────────────────────────────────── */
function Dandiya({ x = 0, y = 0, size = 1 }: { x?: number; y?: number; size?: number }) {
  const stick = (c1: string, c2: string) => (
    <g>
      <rect x="-4" y="-60" width="8" height="120" rx="4" fill={c1} />
      {[-48, -28, -8, 12, 32].map((yy) => <rect key={yy} x="-4" y={yy} width="8" height="9" fill={c2} />)}
      <circle cx="0" cy="-62" r="5" fill="#ffd740" /><circle cx="0" cy="62" r="5" fill="#ffd740" />
    </g>
  );
  return (
    <svg viewBox="-80 -80 160 160" width={160} height={160} style={{ position: 'absolute', left: x, top: y, scale: String(size), transformOrigin: '0 0' }} aria-hidden="true">
      <g className="ps-fx-clash-l" style={{ transformOrigin: '0 0' }}><g transform="rotate(-30)">{stick('#c41e3a', '#f2c14e')}</g></g>
      <g className="ps-fx-clash-r" style={{ transformOrigin: '0 0' }}><g transform="rotate(30)">{stick('#1f5fa8', '#f2c14e')}</g></g>
    </svg>
  );
}
function GarbaPot({ x = 0, y = 0 }: { x?: number; y?: number }) {
  return (
    <svg viewBox="0 0 80 100" width={80} height={100} style={{ position: 'absolute', left: x, top: y }} aria-hidden="true">
      <circle className="ps-fx-glow" cx="40" cy="60" r="36" fill="#ffb84a" opacity=".22" />
      <path d="M22 30q-12 34 18 54q30-20 18-54z" fill="#b8663a" /><ellipse cx="40" cy="30" rx="18" ry="6" fill="#8a4a26" />
      {[[30, 48], [50, 48], [40, 60], [30, 72], [50, 72]].map(([cx, cy]) => <circle key={cx + '' + cy} cx={cx} cy={cy} r="3" fill="#fff1c2" className="ps-fx-twinkle" />)}
      <path d="M40 30c3-4 4-8 .5-14C37 22 37 26 40 30z" fill="#ffb84a" className="ps-fx-flame" style={{ transformOrigin: '40px 30px' }} />
    </svg>
  );
}
/** Ravan dahan: the effigy as the maidan builds it — a tall figure, ten
 *  crowned heads in a fan, shield on one arm and sword in the other, the fire
 *  lit at its feet and climbing. Silhouette only; no face is drawn. */
function RavanDahan({ x = 0, y = 0 }: { x?: number; y?: number }) {
  const ink = '#3a2418';
  const heads = [-4, -3, -2, -1, 1, 2, 3, 4];
  const crown = (cx: number, cy: number, r: number) => `M${cx - r * 0.8} ${cy - r * 0.6}l${r * 0.4} -${r * 0.9} ${r * 0.4} ${r * 0.5} ${r * 0.4} -${r * 0.5} ${r * 0.4} ${r * 0.9}z`;
  return (
    <svg viewBox="0 0 220 280" width={220} height={280} style={{ position: 'absolute', left: x, top: y }} aria-hidden="true">
      <g fill={ink}>
        {/* ten heads: the centre one taller, the others fanning out and stepping down */}
        <circle cx="110" cy="76" r="12" /><path d={crown(110, 68, 12)} />
        {heads.map((k) => { const cx = 110 + k * 15; const cy = 86 + Math.abs(k) * 2.5; return <g key={k}><circle cx={cx} cy={cy} r="7.5" /><path d={crown(cx, cy - 4, 7.5)} /></g>; })}
        {/* shoulders → waist, a belt, a dhoti */}
        <path d="M66 104h88l10 82H56z" /><rect x="60" y="150" width="100" height="6" fill="#c9931a" opacity=".9" />
        <path d="M60 186h100l-6 22H66z" />
        {/* arms: shield on the left, sword raised on the right */}
        <path d="M70 108L28 140l6 8 42-28z" /><circle cx="30" cy="146" r="16" /><circle cx="30" cy="146" r="9" fill="#c9931a" opacity=".85" />
        <path d="M150 108l42 32-6 8-42-28z" /><path d="M186 132l6-4 24-42 6 4z" /><rect x="180" y="130" width="14" height="5" transform="rotate(-30 187 132)" />
        {/* legs */}
        <rect x="80" y="206" width="18" height="60" rx="3" /><rect x="122" y="206" width="18" height="60" rx="3" />
        <rect x="74" y="262" width="30" height="8" rx="3" /><rect x="116" y="262" width="30" height="8" rx="3" />
      </g>
      {/* the fire: lit at the feet, climbing the legs and dhoti */}
      <g className="ps-fx-burn" style={{ transformOrigin: '110px 280px' }}>
        <path d="M110 160c26 36 58 62 42 108-10 30-74 30-84 0-16-46 16-72 42-108z" fill="#ff7a2a" opacity=".88" />
        <path d="M110 206c12 18 28 32 20 56-6 16-34 16-40 0-8-24 8-38 20-56z" fill="#ffc14a" />
        <path d="M58 226c8 12 16 20 12 34-4 10-20 10-24 0-4-14 4-22 12-34zM162 226c8 12 16 20 12 34-4 10-20 10-24 0-4-14 4-22 12-34z" fill="#ff9d3a" opacity=".9" />
      </g>
    </svg>
  );
}
function Bow({ x = 0, y = 0 }: { x?: number; y?: number }) {
  return (
    <svg viewBox="0 0 80 120" width={80} height={120} style={{ position: 'absolute', left: x, top: y }} aria-hidden="true">
      <path d="M20 8q50 52 0 104" stroke="#c9931a" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M20 8L20 112" stroke="#f2c14e" strokeWidth="1.5" /><path d="M20 60h52" stroke="#8a4a26" strokeWidth="3" /><path d="M66 54l10 6-10 6z" fill="#c9931a" />
    </svg>
  );
}
export function NavratriScene({ variant, imageUrl, night }: SceneProps) {
  switch (variant) {
    case 'DUSSEHRA':
      return (<><Bokeh strength={0.5} color="#ff9d3a" /><div className="ps-fest-corner"><RavanDahan x={30} y={-20} /></div><Fall count={6} render={() => <i className="ps-fest-spark" />} /><div className="ps-fest-floor"><Bow x={0} y={-90} /></div></>);
    case 'GARBA':
      return (<><Toran width={1600} fit="slice" className="ps-fest-top" /><div className="ps-fest-corner"><GarbaPot x={140} y={80} /><Dandiya x={40} y={120} size={0.6} /></div></>);
    case 'DURGA':
      return (<><Bokeh strength={night ? 0.9 : 0.6} color="#f2c14e" /><ArtFrame src={imageUrl ?? '/festive/art/durga.webp'} alt="Goddess Durga" credit={imageUrl ? undefined : 'Raja Ravi Varma'} className="ps-fest-art" /></>);
    default: // DANDIYA
      return (<><Toran width={1600} fit="slice" className="ps-fest-top" /><div className="ps-fest-corner"><Dandiya x={110} y={110} /></div></>);
  }
}

/* ── GANESH CHATURTHI ──────────────────────────────────────────────────── */
function Modak({ x = 0, y = 0, size = 1 }: { x?: number; y?: number; size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={40} height={40} style={{ position: 'absolute', left: x, top: y, scale: String(size), transformOrigin: '0 0' }} aria-hidden="true">
      <path d="M20 4c8 12 16 20 16 28a16 8 0 0 1-32 0c0-8 8-16 16-28z" fill="#f2c98a" />
      <path d="M20 4c-3 10-8 18-10 26M20 4c3 10 8 18 10 26M20 4v28" stroke="#d9a35c" strokeWidth="1.2" fill="none" />
      <ellipse cx="20" cy="33" rx="16" ry="5" fill="#e0b070" />
    </svg>
  );
}
function Hibiscus({ x = 0, y = 0, size = 1 }: { x?: number; y?: number; size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={40} height={40} style={{ position: 'absolute', left: x, top: y, scale: String(size), rotate: '-15deg', transformOrigin: '50% 50%' }} aria-hidden="true">
      {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="20" cy="10" rx="7" ry="11" fill="#e63946" transform={`rotate(${a} 20 20)`} />)}
      <circle cx="20" cy="20" r="4" fill="#ffd740" /><path d="M20 20l6-14" stroke="#ffd740" strokeWidth="1.5" />
    </svg>
  );
}
export function GaneshScene({ variant, imageUrl, night }: SceneProps) {
  switch (variant) {
    case 'MODAK':
      return (<><Toran width={1600} fit="slice" className="ps-fest-top" /><div className="ps-fest-floor"><Modak x={0} y={0} /><Modak x={30} y={6} size={0.8} /><Modak x={56} y={0} size={0.9} /><Diya x={100} y={-4} size={0.6} /></div><Fall count={8} render={(i) => <Hibiscus size={0.5 + (i % 3) * 0.15} />} /></>);
    case 'PETALS':
      return (<><Toran width={1600} fit="slice" className="ps-fest-top" /><Fall count={12} render={(i) => <Hibiscus size={0.45 + (i % 3) * 0.15} />} /></>);
    default: // MURTI — the picture, garlanded, with lamps and modaks
      return (<><Bokeh strength={night ? 0.8 : 0.5} color="#f4a94f" /><ArtFrame src={imageUrl ?? '/festive/art/ganesha.webp'} alt="Shri Ganesha" credit={imageUrl ? undefined : 'Ravi Varma Press'} className="ps-fest-art" /><div className="ps-fest-floor"><Modak x={0} y={4} size={0.8} /><Modak x={26} y={8} size={0.7} /></div></>);
  }
}

/* ── ONAM ──────────────────────────────────────────────────────────────── */
function Pookalam({ x = 0, y = 0, size = 1 }: { x?: number; y?: number; size?: number }) {
  const rings = [['#e8952e', 72, 9], ['#fff3c4', 60, 6], ['#c8402f', 50, 8], ['#f6d36b', 39, 6], ['#8e24aa', 30, 7], ['#e8952e', 20, 6]] as const;
  return (
    <svg viewBox="-80 -80 160 160" width={160} height={160} style={{ position: 'absolute', left: x, top: y, scale: String(size), transformOrigin: '0 0' }} aria-hidden="true">
      {rings.map(([c, r, w], i) => <circle key={i} className="ps-fx-bloom" r={r} fill="none" stroke={c} strokeWidth={w} strokeDasharray={`0 ${w * 1.25}`} strokeLinecap="round" style={{ animationDelay: `${i * 0.2}s` }} />)}
      <circle r="10" fill="#c8402f" /><circle r="4" fill="#f6d36b" />
    </svg>
  );
}
function SnakeBoat({ x = 0, y = 0 }: { x?: number; y?: number }) {
  return (
    <svg className="ps-fx-glide" viewBox="0 0 240 60" width={240} height={60} style={{ position: 'absolute', left: x, top: y }} aria-hidden="true">
      <path d="M4 40q100 30 210 0q-20 12-105 14T4 40z" fill="#5a3a1c" /><path d="M214 40q18-6 22-30q-6 14-22 30z" fill="#5a3a1c" />
      {Array.from({ length: 9 }, (_, i) => <g key={i}><circle cx={40 + i * 20} cy="34" r="4" fill="#7a4a2a" /><path d={`M${40 + i * 20} 38l-6 14`} stroke="#c9931a" strokeWidth="2" className="ps-fx-row" style={{ transformOrigin: `${40 + i * 20}px 38px`, animationDelay: `${i * 0.1}s` }} /></g>)}
      <path d="M0 52q120 12 240 0" stroke="#7fc8ff" strokeWidth="3" fill="none" opacity=".6" />
    </svg>
  );
}
export function OnamScene({ variant }: SceneProps) {
  switch (variant) {
    case 'BOAT': return (<><SnakeBoat x={0} y={0} /><div className="ps-fest-corner"><Pookalam x={110} y={90} size={0.7} /></div></>);
    case 'PETALS': return (<><Fall count={12} render={(i) => <i className="ps-fest-petal" style={{ background: ['#e8952e', '#c8402f', '#f6d36b', '#8e24aa'][i % 4] }} />} /><div className="ps-fest-corner"><Pookalam x={110} y={100} size={0.6} /></div></>);
    default: return (<><div className="ps-fest-kasavu" /><div className="ps-fest-corner"><Pookalam x={70} y={60} /></div></>);
  }
}

/* ── DURGA PUJA ────────────────────────────────────────────────────────── */
function Dhak({ x = 0, y = 0 }: { x?: number; y?: number }) {
  return (
    <svg viewBox="0 0 100 80" width={100} height={80} style={{ position: 'absolute', left: x, top: y }} aria-hidden="true">
      <rect x="10" y="20" width="80" height="40" rx="20" fill="#8a4a26" /><ellipse cx="10" cy="40" rx="8" ry="20" fill="#f2e2c4" /><ellipse cx="90" cy="40" rx="8" ry="20" fill="#f2e2c4" />
      {[26, 42, 58, 74].map((x) => <path key={x} d={`M${x} 20v40`} stroke="#f2c14e" strokeWidth="2" />)}
      <path d="M60 10l20 22" stroke="#5a3a1c" strokeWidth="3" strokeLinecap="round" className="ps-fx-beat" style={{ transformOrigin: '80px 32px' }} />
    </svg>
  );
}
export function DurgaScene({ variant, imageUrl, night }: SceneProps) {
  switch (variant) {
    case 'DHAK': return (<><Toran width={1600} fit="slice" className="ps-fest-top" /><div className="ps-fest-corner"><Dhak x={110} y={110} /></div><Fall count={10} render={() => <i className="ps-fest-petal" style={{ background: '#fff8e6', border: '1px solid #f0a63a' }} />} /></>);
    case 'PETALS': return (<><Fall count={14} render={() => <i className="ps-fest-petal" style={{ background: '#fff8e6', border: '1px solid #f0a63a' }} />} /><div className="ps-fest-floor"><Diya x={0} y={0} size={0.7} /><Diya x={50} y={6} size={0.6} delay={0.5} /></div></>);
    default: return (<><Bokeh strength={night ? 0.9 : 0.6} color="#f2c14e" /><ArtFrame src={imageUrl ?? '/festive/art/durga.webp'} alt="Goddess Durga" credit={imageUrl ? undefined : 'Raja Ravi Varma'} className="ps-fest-art" /></>);
  }
}

/* ── VASANT PANCHAMI ───────────────────────────────────────────────────── */
export function VasantScene({ variant, imageUrl }: SceneProps) {
  switch (variant) {
    case 'KITES': return <KiteSky />;
    case 'PETALS': return <Fall count={14} render={() => <i className="ps-fest-petal" style={{ background: '#ffd740' }} />} />;
    default: return (<><Bokeh strength={0.5} color="#ffe27a" /><ArtFrame src={imageUrl ?? '/festive/art/saraswati.webp'} alt="Goddess Saraswati" credit={imageUrl ? undefined : 'Raja Ravi Varma, 1896'} className="ps-fest-art" /><Fall count={8} render={() => <i className="ps-fest-petal" style={{ background: '#ffd740' }} />} /></>);
  }
}

/* ── UGADI & GUDI PADWA ────────────────────────────────────────────────── */
function Gudi({ x = 0, y = 0 }: { x?: number; y?: number }) {
  return (
    <svg viewBox="0 0 80 200" width={80} height={200} style={{ position: 'absolute', left: x, top: y }} aria-hidden="true">
      <rect x="38" y="30" width="4" height="170" fill="#8a6a2a" />
      <path d="M40 40q34 40 0 90q-6-46 0-90z" fill="#c8402f" /><path d="M40 40q-30 40 0 90q6-46 0-90z" fill="#f2c14e" opacity=".9" />
      <path d="M22 40a18 12 0 0 1 36 0v6H22z" fill="#c9931a" /><circle cx="40" cy="26" r="7" fill="#e8952e" />
      {[-14, -6, 2, 10].map((dx, i) => <path key={i} d={`M${40 + dx} 46c-6 2-8 7-6 10 4-1 7-5 6-10z`} fill="#3f6b4a" />)}
    </svg>
  );
}
export function UgadiScene({ variant }: SceneProps) {
  switch (variant) {
    case 'RANGOLI': return (<><Toran width={1600} fit="slice" className="ps-fest-top" /><div className="ps-fest-corner"><Rangoli x={70} y={60} /></div></>);
    case 'PETALS': return (<><Toran width={1600} fit="slice" className="ps-fest-top" /><Fall count={10} render={() => <i className="ps-fest-leaf" />} /></>);
    default: return (<><Toran width={1600} fit="slice" className="ps-fest-top" /><div className="ps-fest-corner"><Gudi x={130} y={0} /></div></>);
  }
}

/* ── BAISAKHI ──────────────────────────────────────────────────────────── */
function Wheat({ x = 0, y = 0, size = 1, delay = 0 }: { x?: number; y?: number; size?: number; delay?: number }) {
  return (
    <svg viewBox="0 0 40 140" width={40} height={140} className="ps-fx-sway" style={{ position: 'absolute', left: x, top: y, scale: String(size), transformOrigin: '50% 100%', animationDelay: `${delay}s` }} aria-hidden="true">
      <path d="M20 140V40" stroke="#c9931a" strokeWidth="2.5" />
      {[0, 1, 2, 3, 4, 5].map((i) => <g key={i}><ellipse cx="13" cy={44 + i * 12} rx="5" ry="9" fill="#e8b04b" transform={`rotate(-25 13 ${44 + i * 12})`} /><ellipse cx="27" cy={40 + i * 12} rx="5" ry="9" fill="#e8b04b" transform={`rotate(25 27 ${40 + i * 12})`} /></g>)}
      <ellipse cx="20" cy="30" rx="5" ry="10" fill="#e8b04b" />
    </svg>
  );
}
export function BaisakhiScene({ variant }: SceneProps) {
  switch (variant) {
    case 'KITES': return <KiteSky />;
    case 'SUN': return (<><span className="ps-fx-sun" aria-hidden="true" /><div className="ps-fest-floor"><Wheat x={0} y={-100} size={0.7} /><Wheat x={22} y={-110} size={0.8} delay={0.4} /><Wheat x={46} y={-96} size={0.65} delay={0.8} /></div></>);
    default: return (<><Bokeh strength={0.4} color="#f6d36b" /><div className="ps-fest-corner"><Wheat x={120} y={40} /><Wheat x={150} y={20} size={1.1} delay={0.5} /><Wheat x={180} y={50} size={0.9} delay={0.9} /></div></>);
  }
}

/* ── SANKRANTI & PONGAL ────────────────────────────────────────────────── */
function PongalPot({ x = 0, y = 0 }: { x?: number; y?: number }) {
  return (
    <svg viewBox="0 0 100 120" width={100} height={120} style={{ position: 'absolute', left: x, top: y }} aria-hidden="true">
      <path d="M30 40q-14 40 20 60q34-20 20-60z" fill="#b8663a" /><ellipse cx="50" cy="40" rx="22" ry="7" fill="#8a4a26" />
      <path d="M30 40h40" stroke="#e8952e" strokeWidth="4" /><path d="M36 50h28" stroke="#fff" strokeWidth="2" opacity=".5" />
      <path className="ps-fx-rise-soft" d="M40 34c4-8 16-8 20 0" fill="#fff8e6" opacity=".9" />
      <path d="M22 108l56-6M24 100l54 8" stroke="#6b4a2a" strokeWidth="6" strokeLinecap="round" />
      <path d="M50 96c10 12 18 20 12 32-4 8-20 8-24 0-6-12 2-20 12-32z" fill="#ff7a2a" className="ps-fx-burn" style={{ transformOrigin: '50px 128px' }} />
    </svg>
  );
}
export function SankrantiScene({ variant }: SceneProps) {
  switch (variant) {
    case 'SUN': return (<><span className="ps-fx-sun" aria-hidden="true" /><KiteSky /></>);
    case 'PONGAL': return (<><Toran width={1600} fit="slice" className="ps-fest-top" /><div className="ps-fest-corner"><PongalPot x={110} y={70} /></div></>);
    default: return <KiteSky />;
  }
}

/* ── RAKSHA BANDHAN ────────────────────────────────────────────────────── */
function Rakhi({ x = 0, y = 0, size = 1 }: { x?: number; y?: number; size?: number }) {
  return (
    <svg viewBox="0 0 200 80" width={200} height={80} style={{ position: 'absolute', left: x, top: y, scale: String(size), transformOrigin: '0 0' }} aria-hidden="true">
      <path d="M0 40q50-14 100 0t100 0" stroke="#c8402f" strokeWidth="3" fill="none" /><path d="M0 44q50-14 100 0t100 0" stroke="#f2c14e" strokeWidth="1.5" fill="none" />
      <g className="ps-fx-spin-slow" style={{ transformOrigin: '100px 40px' }}>
        <circle cx="100" cy="40" r="26" fill="none" stroke="#f2c14e" strokeWidth="6" strokeDasharray="0 9" strokeLinecap="round" />
        <circle cx="100" cy="40" r="16" fill="#c8402f" /><circle cx="100" cy="40" r="8" fill="#f2c14e" /><circle cx="100" cy="40" r="3" fill="#fff" />
      </g>
    </svg>
  );
}
export function RakshaScene({ variant }: SceneProps) {
  switch (variant) {
    case 'MITHAI': return <Fall count={10} render={(i) => <svg viewBox="0 0 24 24" width="20" height="20"><rect x="3" y="6" width="18" height="14" rx="3" fill={['#e63946', '#f2c14e', '#e8952e'][i % 3]} /><rect x="3" y="6" width="18" height="4" fill="#fff" opacity=".4" /></svg>} />;
    default: return (<><Bokeh strength={0.4} color="#ff9fb0" /><div className="ps-fest-corner"><Rakhi x={20} y={90} size={1.1} /></div></>);
  }
}
