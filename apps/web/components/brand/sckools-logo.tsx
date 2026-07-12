/**
 * Sckools brand mark — "Tassel-S" (standalone, swappable).
 *
 * The S is a single monoline stroke that doubles as a graduation tassel cord;
 * the amber bead is the tassel. Pure SVG paths — no font dependency for the
 * symbol. The wordmark is plain styled text so it always matches app type.
 *
 * Variants:
 *  - <SckoolsLogo />                 horizontal lockup (symbol + wordmark)
 *  - <SckoolsLogo animate />         pen-draw entrance (plays once, ~1.6s)
 *  - <SckoolsLogo variant="symbol"/> symbol only (square contexts)
 *  - theme="dark" for dark surfaces (indigo-300 stroke + amber tassel)
 *
 * Hover anywhere on the logo swings the tassel (CSS only). All motion is
 * disabled under prefers-reduced-motion — see globals.css (.sk-*).
 */
import { cn } from '@/lib/cn';

type Props = {
  /** 'full' = symbol + wordmark, 'symbol' = mark only */
  variant?: 'full' | 'symbol';
  /** Pen-draw entrance animation (use once per page, e.g. login) */
  animate?: boolean;
  /** 'light' = for light backgrounds, 'dark' = for dark backgrounds */
  theme?: 'light' | 'dark';
  /** Symbol height in px (wordmark scales with it) */
  size?: number;
  className?: string;
};

export function SckoolsLogo({
  variant = 'full',
  animate = false,
  theme = 'light',
  size = 32,
  className,
}: Props) {
  const stroke = theme === 'dark' ? '#818CF8' : '#4F46E5';
  const tassel = theme === 'dark' ? '#FBBF24' : '#F59E0B';
  const text = theme === 'dark' ? 'text-white' : 'text-slate-900';

  return (
    <span className={cn('sk-logo inline-flex items-center gap-2', className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 52 52"
        aria-hidden="true"
        className="shrink-0"
      >
        {/* Monoline S — one continuous stroke, drawn like handwriting */}
        <path
          className={cn('sk-s', animate && 'sk-s-draw')}
          d="M34 14 C34 8.5 25 7.5 19.3 10 C12 13 13.7 19 23.5 21.4 C33.5 24 35.2 29.7 29.3 33.4 C23.6 37 14.6 35.6 13.6 29.4"
          fill="none"
          stroke={stroke}
          strokeWidth="5"
          strokeLinecap="round"
        />
        {/* Tassel — cord + bead; swings on hover, pops in when animated */}
        <g className="sk-tassel">
          <line
            className={cn(animate && 'sk-tassel-draw')}
            x1="41"
            y1="9"
            x2="41"
            y2="19"
            stroke={tassel}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle
            className={cn(animate && 'sk-bead-pop')}
            cx="41"
            cy="22"
            r="3"
            fill={tassel}
          />
        </g>
      </svg>
      {variant === 'full' && (
        <span
          className={cn(
            'font-extrabold tracking-tight',
            animate && 'sk-wordmark-rise',
            text,
          )}
          style={{ fontSize: size * 0.62, lineHeight: 1 }}
        >
          Sckools
        </span>
      )}
    </span>
  );
}
