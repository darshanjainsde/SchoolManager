/**
 * A generated mark for a programme with no uploaded artwork.
 *
 * It replaces a fixed list of eight emoji cycled by array index — which meant
 * "Senior School (Class 9–12)" showed 🎨 because it happened to be fifth, and
 * any two schools with four programmes showed the identical four pictures.
 * That was the most visible sameness below the fold.
 *
 * Everything here is derived from the programme's own name and mixed from the
 * school's own two brand colours, so it belongs to the programme rather than to
 * its position, and it can never introduce a hue the school's brand does not
 * have.
 *
 * DETERMINISTIC BY CONSTRUCTION. These render on the server and again in the
 * browser; a mark chosen with Math.random would disagree between the two and
 * React 19 discards a mismatched subtree in silence.
 */
export interface ProgrammeMark {
  /** The letter drawn in the tile. `•` when the name has no letter at all. */
  initial: string;
  /** How far to mix --ps2 into --ps1, as a percentage. */
  tint: number;
  /** Gradient angle, so two programmes with the same tint still differ. */
  angle: number;
}

/** Small deterministic string hash (djb2). No randomness, no Date. */
function hash(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h;
}

export function programmeMark(name: string): ProgrammeMark {
  // The first LETTER, not the first character: "(Class 9–12) Senior" must not
  // be represented by an opening bracket.
  const letter = name.match(/\p{L}/u)?.[0];
  const initial = letter ? letter.toUpperCase() : '•';

  const h = hash(name.trim().toLowerCase());
  return {
    initial,
    // 12–72% keeps both ends recognisably the school's, never a wash of one.
    tint: 12 + (h % 7) * 10,
    angle: 100 + ((h >> 3) % 8) * 20,
  };
}
