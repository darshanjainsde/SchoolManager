import { Fall } from './primitives';
import { KiteSky } from './scenes-lights';
import type { SceneProps } from './scene-types';

/* ── INDEPENDENCE & REPUBLIC DAY ───────────────────────────────────────── */
function Flag({ x = 0, y = 0, size = 1 }: { x?: number; y?: number; size?: number }) {
  return (
    <svg viewBox="0 0 200 160" width={200} height={160} style={{ position: 'absolute', left: x, top: y, scale: String(size), transformOrigin: '0 0' }} aria-hidden="true">
      <rect x="10" y="0" width="5" height="160" fill="#6b4a2a" /><circle cx="12.5" cy="0" r="5" fill="#c9931a" />
      <g className="ps-fx-wave" style={{ transformOrigin: '15px 40px' }}>
        <path d="M15 6q40 8 80 0t80 0v30q-40 8-80 0t-80 0z" fill="#e8862a" />
        <path d="M15 36q40 8 80 0t80 0v30q-40 8-80 0t-80 0z" fill="#fff" />
        <path d="M15 66q40 8 80 0t80 0v30q-40 8-80 0t-80 0z" fill="#1f8a45" />
        <g transform="translate(95 51)" fill="none" stroke="#1e3a6e" strokeWidth="1.4"><circle r="11" /><circle r="1.6" fill="#1e3a6e" />{Array.from({ length: 24 }, (_, i) => <path key={i} d="M0-11v9.4" transform={`rotate(${i * 15})`} />)}</g>
      </g>
    </svg>
  );
}
function Bunting({ width = 1600 }: { width?: number }) {
  const n = Math.round(width / 26); const per = width / Math.round(width / 200);
  return (
    <svg viewBox={`0 0 ${width} 34`} width={width} height={34} className="ps-fest-top ps-fx-swing" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      <path d={'M-4 2' + Array.from({ length: Math.round(width / 200) }, () => `q${per / 2} 20 ${per} 0`).join('')} fill="none" stroke="#1e2a4a" strokeWidth="1" opacity=".5" />
      {Array.from({ length: n }, (_, i) => { const x = (i + 0.5) * (width / n); const y = 4 + Math.sin(Math.PI * ((x % per) / per)) * 10; const c = ['#e8862a', '#ffffff', '#1f8a45'][i % 3]; return <path key={i} d={`M${x - 7} ${y}l7 14 7-14z`} fill={c} stroke={c === '#ffffff' ? '#1e2a4a' : 'none'} strokeWidth=".6" />; })}
    </svg>
  );
}
export function TirangaScene({ variant }: SceneProps) {
  switch (variant) {
    case 'FLAG': return (<><div className="ps-fest-corner"><Flag x={40} y={10} /></div></>);
    case 'KITES': return (<><Bunting /><KiteSky /></>);
    case 'TRICOLOR': return (<><Bunting /><Fall count={12} render={(i) => <i className="ps-fest-petal" style={{ background: ['#e8862a', '#ffffff', '#1f8a45'][i % 3], border: i % 3 === 1 ? '1px solid #1e2a4a' : 'none' }} />} /></>);
    default: return (<><Bunting /><div className="ps-fest-chakra" aria-hidden="true" /></>);
  }
}

/* ── GANDHI JAYANTI ────────────────────────────────────────────────────── */
function Charkha({ x = 0, y = 0 }: { x?: number; y?: number }) {
  return (
    <svg viewBox="0 0 200 120" width={200} height={120} style={{ position: 'absolute', left: x, top: y }} aria-hidden="true">
      <rect x="10" y="100" width="180" height="8" rx="3" fill="#8a6a2a" />
      <g className="ps-fx-spin-slow" style={{ transformOrigin: '60px 60px' }}>
        <circle cx="60" cy="60" r="40" fill="none" stroke="#8a6a2a" strokeWidth="6" /><circle cx="60" cy="60" r="6" fill="#8a6a2a" />
        {Array.from({ length: 12 }, (_, i) => <path key={i} d="M60 60L60 22" stroke="#8a6a2a" strokeWidth="2.5" transform={`rotate(${i * 30} 60 60)`} />)}
      </g>
      <path d="M60 60L160 80" stroke="#f2e2c4" strokeWidth="1.5" /><circle cx="160" cy="80" r="14" fill="none" stroke="#8a6a2a" strokeWidth="4" className="ps-fx-spin" style={{ transformOrigin: '160px 80px' }} />
      <rect x="100" y="60" width="4" height="40" fill="#8a6a2a" /><rect x="150" y="90" width="20" height="10" fill="#8a6a2a" />
    </svg>
  );
}
export function GandhiScene({ variant }: SceneProps) {
  switch (variant) {
    case 'DOVE': return <Fall count={6} render={() => <svg viewBox="0 0 40 30" width="30" height="22"><path d="M2 16c8-8 16-8 22-2l14-8-8 12c4 4 4 8 0 12-8-2-14 0-20 4 2-6 0-12-8-18z" fill="#fff" stroke="#8a8a8a" strokeWidth=".6" /></svg>} />;
    default: return (<><div className="ps-fest-corner"><Charkha x={40} y={70} /></div></>);
  }
}

/* ── CHILDREN'S DAY ────────────────────────────────────────────────────── */
export function ChildrensScene({ variant }: SceneProps) {
  const colors = ['#f0409c', '#2196f3', '#ffc107', '#26c281', '#ff5722'];
  switch (variant) {
    case 'DOODLES': return <Fall count={12} render={(i) => <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2l3 7 7 .8-5.3 4.8 1.6 7L12 18l-6.3 3.6 1.6-7L2 9.8 9 9z" fill={colors[i % colors.length]} /></svg>} />;
    case 'CRAYONS': return <Fall count={10} render={(i) => <svg viewBox="0 0 12 40" width="12" height="40"><path d="M6 0l5 8v32H1V8z" fill={colors[i % colors.length]} /><rect x="1" y="14" width="10" height="6" fill="#fff" opacity=".5" /></svg>} />;
    default: return (
      <>
        {[3, 18, 34, 52, 70, 86].map((left, i) => (
          <span key={i} className="ps-fx-rise" style={{ left: `${left}%`, animationDuration: `${9 + i * 1.3}s`, animationDelay: `${i * 0.9}s` }} aria-hidden="true">
            <svg viewBox="0 0 30 46" width="28" height="44"><ellipse cx="15" cy="16" rx="13" ry="16" fill={colors[i % colors.length]} /><ellipse cx="10" cy="10" rx="4" ry="6" fill="#fff" opacity=".35" /><path d="M13 32h4l-2 4z" fill={colors[i % colors.length]} /><path d="M15 36q-4 6 0 10" stroke="#888" strokeWidth="1" fill="none" /></svg>
          </span>
        ))}
      </>
    );
  }
}

/* ── TEACHER'S DAY ─────────────────────────────────────────────────────── */
function Board({ x = 0, y = 0 }: { x?: number; y?: number }) {
  return (
    <svg viewBox="0 0 200 140" width={200} height={140} style={{ position: 'absolute', left: x, top: y }} aria-hidden="true">
      <rect x="6" y="6" width="188" height="118" rx="6" fill="#6b4a2a" /><rect x="14" y="14" width="172" height="102" fill="#2e5e4a" />
      <path className="ps-fx-chalk" d="M30 44q30-8 60 0t60 0" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path className="ps-fx-chalk" d="M30 70h80" stroke="#fff" strokeWidth="2" strokeLinecap="round" style={{ animationDelay: '.8s' }} />
      <path className="ps-fx-chalk" d="M30 92h110" stroke="#fff" strokeWidth="2" strokeLinecap="round" style={{ animationDelay: '1.6s' }} />
      <rect x="60" y="124" width="80" height="6" rx="2" fill="#8a6a2a" /><rect x="150" y="118" width="16" height="5" rx="2" fill="#fff" />
    </svg>
  );
}
export function TeachersScene({ variant }: SceneProps) {
  switch (variant) {
    case 'GOLDDUST': return <Fall count={12} render={() => <i className="ps-fest-spark" />} />;
    case 'BOOKS': return <Fall count={10} render={(i) => <svg viewBox="0 0 28 24" width="26" height="22"><path d="M2 4h10a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3H2z" fill={['#c8402f', '#1f5fa8', '#1f7a3d'][i % 3]} /><path d="M26 4H16a3 3 0 0 0-3 3v15a3 3 0 0 1 3-3h10z" fill={['#e8862a', '#8e24aa', '#f2c14e'][i % 3]} /></svg>} />;
    default: return (<><div className="ps-fest-corner"><Board x={20} y={50} /></div></>);
  }
}
