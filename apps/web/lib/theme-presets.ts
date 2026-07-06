export interface ThemePreset { primary: string; secondary: string; headingFont: string; }

export const THEME_PRESETS: Record<string, ThemePreset> = {
  ACADEMIC: { primary: '#2f6b4f', secondary: '#e8b04b', headingFont: 'FRAUNCES' },
  MODERN:   { primary: '#3b4ee0', secondary: '#38bdf8', headingFont: 'POPPINS' },
  PLAYFUL:  { primary: '#f2653f', secondary: '#12b3a6', headingFont: 'NUNITO' },
  ELEGANT:  { primary: '#7a2233', secondary: '#d9c7a3', headingFont: 'FRAUNCES' },
};

export const FONT_OPTIONS = [
  { value: 'INTER',    label: 'Inter (neutral)' },
  { value: 'FRAUNCES', label: 'Fraunces (academic serif)' },
  { value: 'POPPINS',  label: 'Poppins (rounded)' },
  { value: 'NUNITO',   label: 'Nunito (friendly)' },
];

export const HERO_OPTIONS = [
  { value: 'ILLUSTRATION', label: 'Illustrated (animated)' },
  { value: 'PHOTO',        label: 'Photo backdrop (building photo behind the landing)' },
  { value: 'MINIMAL',      label: 'Minimal / calm' },
];

export const MOTION_OPTIONS = [
  { value: 'FULL',   label: 'Full' },
  { value: 'SUBTLE', label: 'Subtle' },
  { value: 'NONE',   label: 'Off' },
];
