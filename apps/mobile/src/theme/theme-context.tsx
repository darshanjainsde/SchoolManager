import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { useColorScheme } from 'react-native';
import { brandedLight } from './school-brand';
import { readCachedBrand, refreshSchoolBrand } from '@/lib/school-brand-client';
import * as SecureStore from 'expo-secure-store';
import { GAP, RADIUS, palette, type ColorPalette, type ColorScheme } from './tokens';
import {
  GROUNDS,
  applyGround,
  isGroundName,
  isPaperPattern,
  type GroundName,
  type PaperPattern,
} from './grounds';
import { ACCENTS, applyAccent, isAccentName, type AccentName } from './accents';

export type ThemePreference = 'system' | ColorScheme;

// Not sensitive — reuses expo-secure-store (already a dependency, see
// `src/lib/session.ts`) rather than adding an AsyncStorage-equivalent
// dependency purely for a UI preference.
const PREF_KEY = 'sckools.themePreference';
const GROUND_KEY = 'sckools.ground';
const PATTERN_KEY = 'sckools.paperPattern';
const ACCENT_KEY = 'sckools.accent';

function isThemePreference(v: string | null): v is ThemePreference {
  return v === 'system' || v === 'light' || v === 'dark';
}

interface ThemeContextValue {
  /** Resolved scheme actually in effect right now. */
  scheme: ColorScheme;
  /** The user's stated choice — 'system' means "follow the OS". */
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
  /** The paper this person reads on. Personal; never the school's business. */
  ground: GroundName;
  setGround: (next: GroundName) => void;
  /** Ruling behind the page. Grain is a separate axis, not a fourth pattern. */
  pattern: PaperPattern;
  setPattern: (next: PaperPattern) => void;
  /** Highlight colour. 'school' defers to the school's own brand. */
  accent: AccentName;
  setAccent: (next: AccentName) => void;
  tokens: { color: ColorPalette; gap: number; radius: typeof RADIUS };
}

// Default value (light scheme, no-op setter) used by any tree that renders a
// theme-aware component WITHOUT a <ThemeProvider> ancestor — most of this
// app's existing component/screen tests do exactly that, since they predate
// dark mode and render the component in isolation. Falling back to the
// (unchanged) light palette instead of throwing means none of those tests
// had to be rewritten just to add a provider wrapper they don't care about;
// only the theme-system tests themselves render a real <ThemeProvider>.
const defaultThemeContext: ThemeContextValue = {
  scheme: 'light',
  preference: 'system',
  setPreference: () => undefined,
  // 'classic' reproduces today's palette exactly, so a tree without a provider
  // renders precisely what it rendered before grounds existed.
  ground: 'classic',
  setGround: () => undefined,
  pattern: 'plain',
  setPattern: () => undefined,
  accent: 'school',
  setAccent: () => undefined,
  tokens: { color: palette.light, gap: GAP, radius: RADIUS },
};

const ThemeContext = createContext<ThemeContextValue>(defaultThemeContext);

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null | undefined
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  // THE DEFAULTS A REAL PERSON GETS. `classic` shipped first so that adding
  // grounds could not restyle anyone before the shade had been seen on an
  // actual phone; that has now been decided, so the app opens on warm cream
  // with feint ruling. Anyone who had already chosen something keeps it — the
  // stored value wins over these on the next tick.
  const [ground, setGroundState] = useState<GroundName>('cream');
  const [pattern, setPatternState] = useState<PaperPattern>('ruled');
  // 'school' is the default so an app still looks like the place a person goes;
  // choosing a named accent is an opt-out, not the starting point.
  const [accent, setAccentState] = useState<AccentName>('school');
  // The school's own colour, for the LIGHT scheme only. Cache first so the
  // theme is right on the frame the app opens rather than one round-trip
  // later; the network refresh then updates it for the next launch.
  const [brand, setBrand] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readCachedBrand().then((b) => {
      if (!cancelled && b) setBrand(b.primary);
    });
    void refreshSchoolBrand().then((b) => {
      if (!cancelled && b) setBrand(b.primary);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(PREF_KEY).then((stored) => {
      if (!cancelled && isThemePreference(stored)) setPreferenceState(stored);
    });
    SecureStore.getItemAsync(GROUND_KEY).then((stored) => {
      if (!cancelled && isGroundName(stored)) setGroundState(stored);
    });
    SecureStore.getItemAsync(PATTERN_KEY).then((stored) => {
      if (!cancelled && isPaperPattern(stored)) setPatternState(stored);
    });
    SecureStore.getItemAsync(ACCENT_KEY).then((stored) => {
      if (!cancelled && isAccentName(stored)) setAccentState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function setPreference(next: ThemePreference) {
    setPreferenceState(next);
    // Best-effort persistence — a failed write still applies the choice for
    // the rest of this session, it just won't survive an app restart.
    SecureStore.setItemAsync(PREF_KEY, next).catch(() => undefined);
  }

  function setGround(next: GroundName) {
    setGroundState(next);
    SecureStore.setItemAsync(GROUND_KEY, next).catch(() => undefined);
  }

  function setPattern(next: PaperPattern) {
    setPatternState(next);
    SecureStore.setItemAsync(PATTERN_KEY, next).catch(() => undefined);
  }

  function setAccent(next: AccentName) {
    setAccentState(next);
    SecureStore.setItemAsync(ACCENT_KEY, next).catch(() => undefined);
  }

  const scheme: ColorScheme =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      scheme,
      preference,
      setPreference,
      ground,
      setGround,
      pattern,
      setPattern,
      accent,
      setAccent,
      // A school picks its colours for a website on warm paper, which is what
      // the light theme is — so the colour travels there and nowhere else. The
      // dark scheme keeps its own indigo ink: a brand chosen against white can
      // fail badly on a near-black surface, and no semantic colour moves in
      // either scheme.
      // Ground goes on LAST and touches only the neutrals, so a person's choice
      // of paper can never repaint their school's colour or the green and red
      // that mean present and absent.
      // Order matters. The school's brand paints the accent FIRST, then an
      // explicit choice overrides it, then the ground lays the neutrals on top
      // — so a named accent beats the school (it was asked for), and neither
      // can reach the neutrals. A chosen accent holds in dark too: it was
      // picked deliberately, unlike a brand chosen against a white website.
      tokens: {
        color: applyGround(
          applyAccent(
            scheme === 'light' ? brandedLight(palette.light, brand) : palette.dark,
            ACCENTS[accent][scheme],
          ),
          GROUNDS[ground][scheme],
        ),
        gap: GAP,
        radius: RADIUS,
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheme, preference, brand, ground, pattern, accent],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** Convenience hook for the common case: just the theme-aware colour tokens. */
export function useTokens() {
  return useTheme().tokens;
}
