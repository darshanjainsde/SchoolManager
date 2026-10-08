/**
 * The fixed colours of the empty-state pictures (components/Illustration):
 * confetti, coins, a kite, the four house flags. They are part of the
 * drawing, not of the theme, so they do not follow the school colour — but
 * they live here, with the other palettes, so no component carries a literal
 * hex (src/__tests__/hex-sweep.test.ts).
 */
export const ART = {
  night: '#12142B',
  paperDark: '#1F2440',
  green: '#22C55E',
  faintDark: '#363D5A',
  blue: '#3B82F6',
  roof: '#9A3412',
  bronze: '#A9AECB',
  coinDark: '#B45309',
  silver: '#C7CAE0',
  ochre: '#D97706',
  rose: '#DB2777',
  faint: '#E4E6F0',
  pink: '#EC4899',
  red: '#EF4444',
  amber: '#F59E0B',
  gold: '#FBBF24',
  sun: '#FDE68A',
  white: '#FFFFFF',
} as const;
