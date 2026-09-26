/**
 * THE FESTIVE DRAWING KIT — the objects every scene is built from.
 *
 * Flat, clean vector illustration in the manner of a good festival poster:
 * proper proportions, a small number of confident colours, no gradients that
 * read as "computer". Each object is a React component that renders inline
 * SVG so it can take the scene's palette through props and animate its own
 * parts (a flame, a swinging lantern) with CSS classes the stylesheet owns
 * (`.ps-fx-*`, opacity/transform only, all silenced by Animation = Off).
 *
 * Deities are NOT drawn here. They come from public-domain classical
 * paintings (see public/festive/art/CREDITS.md) shown in <ArtFrame>, or from
 * the school's own upload.
 */
import type { CSSProperties, ReactNode } from 'react';

type P = { x?: number; y?: number; size?: number; style?: CSSProperties; className?: string; delay?: number };
// `scale` (the individual transform property), not transform: scale(), so a
// CSS animation that owns `transform` (a swing, a sway) composes with the
// size instead of replacing it. Left/top only when given, so a CSS rule can
// place an object the scene did not pin.
const at = ({ x, y, size = 1, style, delay }: P): CSSProperties => ({
  position: 'absolute', ...(x !== undefined ? { left: x } : {}), ...(y !== undefined ? { top: y } : {}),
  ...(size !== 1 ? { scale: String(size), transformOrigin: '0 0' } : {}),
  ...(delay ? { animationDelay: `${delay}s` } : {}), ...style,
});

/** A clay diya with a live flame. 60×44 at size 1. */
export function Diya({ lit = true, ...p }: P & { lit?: boolean }) {
  return (
    <svg viewBox="0 0 60 44" width={60} height={44} style={at(p)} aria-hidden="true" className={p.className}>
      {lit && <ellipse cx="30" cy="40" rx="30" ry="5" fill="#f2a13a" opacity=".25" />}
      {lit && <circle className="ps-fx-glow" cx="30" cy="16" r="16" fill="#ffb84a" opacity=".22" />}
      <path d="M8 26c-1 6 7 12 22 12s23-6 22-12c0-2-2-2-3-2H11c-1 0-3 0-3 2z" fill="#9a4b2a" />
      <path d="M8 25q22-6 44 0q-2-3-22-4t-22 4z" fill="#b86a40" />
      <ellipse cx="30" cy="24.5" rx="16" ry="2.8" fill="#3a1a0d" />
      <path d="M30 24v-4" stroke="#2a1208" strokeWidth="1.5" strokeLinecap="round" />
      {lit && (
        <g className="ps-fx-flame" style={{ transformOrigin: '30px 21px' }}>
          <path d="M30 21c4-6 5-12 .6-21C26 9 26 15 30 21z" fill="#ffb84a" />
          <path d="M30 19c2-4 2.5-8 .3-13C28 11 28 15 30 19z" fill="#fff1c2" />
        </g>
      )}
    </svg>
  );
}

/** An akash kandil — the paper star lantern hung at the door. 44×70. */
export function Kandil({ color = '#c8402f', ...p }: P & { color?: string }) {
  return (
    <svg viewBox="0 0 44 70" width={44} height={70} style={at(p)} aria-hidden="true" className={`ps-fx-swing ${p.className ?? ''}`}>
      <path d="M22 0v8" stroke="#7a5a2a" strokeWidth="1.2" />
      <circle cx="22" cy="26" r="13" fill="#ffd27a" opacity=".55" />
      <path d="M22 8l5.5 11 12 1.2-9 8.2 2.8 12L22 34.6 10.7 40.4l2.8-12-9-8.2 12-1.2z" fill={color} />
      <path d="M22 14l3.2 6.4 7 .7-5.2 4.8 1.6 7L22 29.5l-6.6 3.4 1.6-7-5.2-4.8 7-.7z" fill="#ffe08a" opacity=".9" />
      <g stroke={color} strokeWidth="2.6" strokeLinecap="round"><path d="M14 44v16M19 44v22M25 44v22M30 44v16" /></g>
    </svg>
  );
}

/** A brass samai / kuthu vilakku, five wicks. 70×160. */
export function Samai(p: P) {
  return (
    <svg viewBox="0 0 70 160" width={70} height={160} style={at(p)} aria-hidden="true">
      <defs><linearGradient id="fx-brass" x1="0" x2="1"><stop offset="0" stopColor="#7a5418" /><stop offset=".4" stopColor="#e2b95c" /><stop offset=".6" stopColor="#f6dc95" /><stop offset="1" stopColor="#6e4a12" /></linearGradient></defs>
      <circle className="ps-fx-glow" cx="35" cy="40" r="40" fill="#ffb84a" opacity=".18" />
      <ellipse cx="35" cy="154" rx="28" ry="6" fill="url(#fx-brass)" /><ellipse cx="35" cy="148" rx="20" ry="4.5" fill="url(#fx-brass)" />
      <rect x="31.5" y="52" width="7" height="98" fill="url(#fx-brass)" />
      <circle cx="35" cy="126" r="6.5" fill="url(#fx-brass)" /><circle cx="35" cy="96" r="6" fill="url(#fx-brass)" /><circle cx="35" cy="68" r="5.5" fill="url(#fx-brass)" />
      <path d="M9 48c0 7 12 11 26 11s26-4 26-11z" fill="url(#fx-brass)" /><ellipse cx="35" cy="48" rx="26" ry="5" fill="#8a6220" />
      {[9, 22, 35, 48, 61].map((x, i) => (
        <g key={x} className="ps-fx-flame" style={{ transformOrigin: `${x}px 46px`, animationDelay: `${i * 0.25}s` }}>
          <path d={`M${x} 46c3-4 3.5-8 .5-14C${x - 3.5} 38 ${x - 3} 42 ${x} 46z`} fill="#ffb84a" />
        </g>
      ))}
      <path d="M35 44l-4-8 4-14 4 14z" fill="url(#fx-brass)" /><circle cx="35" cy="19" r="3.5" fill="#e2b95c" />
    </svg>
  );
}

/** A flower rangoli: rings of marigold and rose petals. 160×160. */
export function Rangoli({ line = false, color = '#e8952e', ...p }: P & { line?: boolean; color?: string }) {
  return (
    <svg viewBox="-80 -80 160 160" width={160} height={160} style={at(p)} aria-hidden="true" className={p.className}>
      {line ? (
        <g fill="none" stroke={color} strokeWidth="1.3">
          <circle r="76" /><circle r="62" /><circle r="12" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <ellipse key={a} cx="0" cy="-44" rx="11" ry="26" transform={`rotate(${a})`} />)}
          {Array.from({ length: 16 }, (_, i) => <ellipse key={i} cx="0" cy="-24" rx="5" ry="12" transform={`rotate(${22.5 * i})`} />)}
          <circle r="69" strokeWidth="3" strokeDasharray="0 9" strokeLinecap="round" />
        </g>
      ) : (
        <>
          <circle r="72" fill="none" stroke="#e8952e" strokeWidth="9" strokeDasharray="0 11.6" strokeLinecap="round" />
          <circle r="60" fill="none" stroke="#f0b93a" strokeWidth="7" strokeDasharray="0 9.4" strokeLinecap="round" />
          <circle r="49" fill="none" stroke="#d9822b" strokeWidth="7" strokeDasharray="0 9" strokeLinecap="round" />
          <circle r="38" fill="none" stroke="#f6d36b" strokeWidth="5" strokeDasharray="0 7.2" strokeLinecap="round" />
          <circle r="28" fill="none" stroke="#c8402f" strokeWidth="8" strokeDasharray="0 8.3" strokeLinecap="round" />
          <circle r="17" fill="#c8402f" /><circle r="9" fill="#e8952e" /><circle r="4" fill="#f6d36b" />
        </>
      )}
    </svg>
  );
}

/** The drooping thread every strip hangs from: one scallop per 200 units, so a
 *  strip cropped to any band width still reads as a hung string. */
const scallops = (width: number, y0: number, sag: number) => {
  const n = Math.max(1, Math.round(width / 200)); const w = width / n;
  return `M-4 ${y0}` + Array.from({ length: n }, () => `q${w / 2} ${sag * 2} ${w} 0`).join('') + 'l8 0';
};
const sagAt = (x: number, width: number, y0: number, sag: number) => { const w = width / Math.max(1, Math.round(width / 200)); const t = (x % w) / w; return y0 + Math.sin(Math.PI * t) * sag; };
/**
 * A toran of marigolds and mango leaves. `fit="slice"` with a wide `width`
 * (1600) is for the band's top edge: the CSS makes the <svg> 100% wide and the
 * drawing is CROPPED to it, never stretched — marigolds stay round on a 1920
 * monitor and on a 360 phone alike. `fit="meet"` is for a small framed toran.
 */
export function Toran({ width = 380, fit = 'meet', ...p }: P & { width?: number; fit?: 'meet' | 'slice' }) {
  const n = Math.max(6, Math.round(width / 26));
  return (
    <svg viewBox={`0 0 ${width} 34`} width={width} height={34} style={at(p)} aria-hidden="true" className={`ps-fx-swing ${p.className ?? ''}`} preserveAspectRatio={fit === 'slice' ? 'xMidYMin slice' : 'xMidYMin meet'}>
      <path d={scallops(width, 2, 10)} fill="none" stroke="#7a5a2a" strokeWidth="1.2" />
      {Array.from({ length: n }, (_, i) => {
        const x = (i + 0.5) * (width / n);
        const y = sagAt(x, width, 2, 10);
        return i % 2 === 0 ? (
          <g key={i} transform={`translate(${x} ${y + 6})`}><circle cx="-2" cy="1" r="5.2" fill="#d9822b" /><circle cx="2.5" cy="-1" r="4.6" fill="#f0a63a" /><circle cx="0" cy="2.5" r="3.8" fill="#e8952e" /></g>
        ) : (
          <g key={i} transform={`translate(${x} ${y + 4})`}><path d="M0 0c-6 2-8 7-6 10 4-1 7-5 6-10z" fill="#3f6b4a" /><path d="M0 0c6 2 8 7 6 10-4-1-7-5-6-10z" fill="#4a7a55" /></g>
        );
      })}
    </svg>
  );
}

/** A string of small bulbs with a lamp every 80 units. Same fit rule as Toran. */
export function Bulbs({ width = 380, color = '#c98a3a', fit = 'meet', ...p }: P & { width?: number; color?: string; fit?: 'meet' | 'slice' }) {
  const count = Math.max(3, Math.round(width / 80));
  const lamps = Array.from({ length: count }, (_, i) => (i + 0.5) / count);
  return (
    <svg viewBox={`0 0 ${width} 34`} width={width} height={34} style={at(p)} aria-hidden="true" className={p.className} preserveAspectRatio={fit === 'slice' ? 'xMidYMin slice' : 'xMidYMin meet'}>
      <path d={scallops(width, 4, 8)} fill="none" stroke={color} strokeWidth="1" opacity=".55" />
      <path d={scallops(width, 4, 8)} fill="none" stroke="#ffd98a" strokeWidth="3.2" strokeDasharray="0 11" strokeLinecap="round" opacity=".95" />
      {lamps.map((t, i) => {
        const x = t * width; const y = sagAt(x, width, 4, 8) + 10;
        return (
          <g key={i}>
            <path d={`M${x} ${y - 8}v6`} stroke={color} strokeWidth="1" opacity=".7" />
            <circle cx={x} cy={y + 3} r="9" fill="#ffd27a" opacity=".35" />
            <circle className="ps-fx-twinkle" cx={x} cy={y + 3} r="4.5" fill="#ffe3a3" style={{ animationDelay: `${i * 0.35}s` }} />
          </g>
        );
      })}
    </svg>
  );
}

/** Out-of-focus lights, denser to the right. A CSS layer, not a filter. */
export function Bokeh({ color = 'var(--ps-fest-glow)', strength = 1, style }: { color?: string; strength?: number; style?: CSSProperties }) {
  return <div className="ps-fest-bokeh" style={{ ['--ps-fest-glow' as string]: color, opacity: strength, ...style }} aria-hidden="true" />;
}

/** A night sky: stars that twinkle on their own phases. */
export function Stars({ count = 26, night = true, color }: { count?: number; night?: boolean; color?: string }) {
  const fill = color ?? (night ? '#fff6d6' : '#b8862b');
  // Constants, not Math.random(): server and client must agree.
  const pts = Array.from({ length: count }, (_, i) => [((i * 37) % 97) + 1.5, ((i * 53) % 61) + 2, 0.8 + ((i * 7) % 5) * 0.25, (i % 6) * 0.35] as const);
  return (
    <svg className="ps-fest-stars" viewBox="0 0 100 70" preserveAspectRatio="none" aria-hidden="true">
      {pts.map(([x, y, r, d], i) => <circle key={i} className="ps-fx-twinkle" cx={x} cy={y} r={r / 4} fill={fill} style={{ animationDelay: `${d}s` }} />)}
    </svg>
  );
}

/**
 * A framed picture — how a print of a deity actually hangs in a home: in an
 * arched frame, a garland over it, two lamps beneath. Takes the shipped
 * public-domain painting or the school's own upload. Never crops a figure
 * out of its painting.
 */
export function ArtFrame({ src, alt, credit, width = 150, garland = true, lamps = true, ...p }: P & { src: string; alt: string; credit?: string; width?: number; garland?: boolean; lamps?: boolean }) {
  const h = Math.round(width * 1.38);
  return (
    <figure className={`ps-fest-frame ${p.className ?? ''}`} style={{ ...at(p), width, margin: 0 }} data-art={alt}>
      <div className="ps-fest-frame-arch" style={{ width, height: h }}>
        {/* Decorative inside an aria-hidden dress; the painting's name travels in data-art for tests and tooling. */}
        <img src={src} alt="" decoding="async" fetchPriority="low" width={width} height={h} />
      </div>
      {garland && <Toran width={width + 24} x={-12} y={-4} />}
      {lamps && (
        <>
          <Diya x={-6} y={h - 26} size={0.55} />
          <Diya x={width - 28} y={h - 26} size={0.55} delay={0.6} />
        </>
      )}
      {credit && <figcaption className="ps-fest-credit">{credit}</figcaption>}
    </figure>
  );
}

/** Falling things — petals, snow, confetti — on fixed lanes and phases. */
export function Fall({ count = 14, render, className = '' }: { count?: number; render: (i: number) => ReactNode; className?: string }) {
  const lanes = [3, 9, 16, 22, 30, 37, 45, 52, 58, 66, 73, 80, 87, 93, 12, 41, 63, 84];
  const dur = [7.2, 9.1, 6.4, 8.3, 10.2, 7.7, 9.6, 6.9, 8.8, 7.4, 9.9, 6.6, 8.1, 9.3, 7.9, 8.6, 6.7, 9.4];
  const del = [0, 2.1, 4.3, 1.2, 3.4, 5.6, 0.8, 2.9, 5.1, 1.7, 3.9, 0.4, 2.5, 4.7, 1.9, 3.1, 5.3, 0.6];
  return (
    <>
      {Array.from({ length: Math.min(count, lanes.length) }, (_, i) => (
        <span key={i} className={`ps-fx-fall ${className}`} style={{ left: `${lanes[i]}%`, animationDuration: `${dur[i]}s`, animationDelay: `${del[i]}s` }} aria-hidden="true">
          {render(i)}
        </span>
      ))}
    </>
  );
}
