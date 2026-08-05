import { programmeMark } from './programme-mark';

/**
 * The tile a programme shows when the school has uploaded no artwork — which
 * is most programmes on most schools. See `programme-mark.ts` for why it is
 * generated from the name rather than picked from a list of emoji.
 *
 * The initial is drawn large and low-contrast against the school's own blend,
 * so it reads as a considered mark rather than as a missing image.
 */
export default function ProgrammeMark({ name, className }: { name: string; className?: string }) {
  const { initial, tint, angle } = programmeMark(name);
  return (
    <div
      className={`grid place-items-center overflow-hidden ${className ?? ''}`}
      style={{
        background: `linear-gradient(${angle}deg, var(--ps1), color-mix(in srgb, var(--ps2) ${tint}%, var(--ps1)))`,
      }}
      // The letter is decoration: the programme's name is already the heading
      // beside it, and reading "P" aloud before it helps nobody.
      aria-hidden="true"
    >
      <span
        className="ps-head font-bold leading-none select-none"
        style={{ fontSize: 'clamp(2.5rem, 6vw, 4rem)', color: 'rgba(255,255,255,.92)' }}
      >
        {initial}
      </span>
    </div>
  );
}
