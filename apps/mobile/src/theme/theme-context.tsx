import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { useColorScheme } from 'react-native';
import { applyInkLit } from './inklit';
import { readCachedBrand, refreshSchoolBrand } from '@/lib/school-brand-client';
import * as SecureStore from 'expo-secure-store';
import { GAP, RADIUS, palette, type ColorPalette, type ColorScheme } from './tokens';
import {
  GROUNDS,
  applyGround,
  isGroundName,
  type GroundName,
} from './grounds';
import { readAccent, rolesFor, type AccentName } from './accents';

export type ThemePreference = 'system' | ColorScheme;

// Not sensitive — reuses expo-secure-store (already a dependency, see
// `src/lib/session.ts`) rather than adding an AsyncStorage-equivalent
// dependency purely for a UI preference.
const PREF_KEY = 'sckools.themePreference';
const GROUND_KEY = 'sckools.ground';
const ACCENT_KEY = 'sckools.accent';

/** One stored choice; a failed read is "nothing stored", never a crash at boot. */
function readStored(key: string): Promise<string | null> {
  return Promise.resolve()
    .then(() => SecureStore.getItemAsync(key))
    .catch(() => null);
}

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
  accent: 'school',
  setAccent: () => undefined,
  tokens: { color: palette.light, gap: GAP, radius: RADIUS },
};

const ThemeContext = createContext<ThemeContextValue>(defaultThemeContext);

interface StoredLook {
  preference: ThemePreference;
  ground: GroundName;
  accent: AccentName;
  /** True once the three stored choices have been read (or found missing). */
  loaded: boolean;
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null | undefined
  // ONE state object for the three stored choices, so reading them at boot is
  // one re-render of the whole app rather than three (each setter used to
  // land on its own tick).
  //
  // THE DEFAULTS A REAL PERSON GETS. `classic` shipped first so that adding
  // grounds could not restyle anyone before the shade had been seen on an
  // actual phone; that has now been decided, so the app opens on warm cream
  // with feint ruling. Anyone who had already chosen something keeps it — the
  // stored value wins over these once it has been read.
  // UI v2: Fresh is the default; a stored choice still wins (below).
  // 'school' is the default so an app still looks like the place a person goes;
  // choosing a named accent is an opt-out, not the starting point.
  // Green is the colour the user picked in the Colour Studio (19 Oct 2026);
  // 'My school' builds the same system from the school's brand.
  const [look, setLook] = useState<StoredLook>({
    preference: 'system',
    ground: 'fresh',
    accent: 'green',
    loaded: false,
  });
  const { preference, ground, accent } = look;
  // A choice made on this launch before the store answered must not be
  // overwritten by the stored one when it lands.
  const touched = useRef<{ preference?: true; ground?: true; accent?: true }>({});
  // The school's own colour, for the LIGHT scheme only. Cache first so the
  // theme is right on the frame the app opens rather than one round-trip
  // later; the network refresh then updates it for the next launch.
  const [brand, setBrand] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      readStored(PREF_KEY),
      readStored(GROUND_KEY),
      readStored(ACCENT_KEY),
    ]).then(([storedPref, storedGround, storedAccent]) => {
      if (cancelled) return;
      const a = readAccent(storedAccent);
      setLook((cur) => ({
        preference: !touched.current.preference && isThemePreference(storedPref) ? storedPref : cur.preference,
        ground: !touched.current.ground && isGroundName(storedGround) ? storedGround : cur.ground,
        accent: !touched.current.accent && a ? a : cur.accent,
        loaded: true,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The cached brand is one local read, so it is always taken (it is what
  // makes 'My school' right on its first frame).
  useEffect(() => {
    let cancelled = false;
    void readCachedBrand().then((b) => {
      if (!cancelled && b) setBrand(b.primary);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The NETWORK refresh is the whole public site (GET /public/site) fetched to
  // read one colour, and only 'My school' paints with it — so it waits until
  // the stored accent has been read, and runs only when that accent is
  // 'school'. Choosing 'My school' later fetches it then.
  const wantsBrand = look.loaded && accent === 'school';
  useEffect(() => {
    if (!wantsBrand) return;
    let cancelled = false;
    void refreshSchoolBrand().then((b) => {
      if (!cancelled && b) setBrand(b.primary);
    });
    return () => {
      cancelled = true;
    };
  }, [wantsBrand]);

  function setPreference(next: ThemePreference) {
    touched.current.preference = true;
    setLook((cur) => ({ ...cur, preference: next }));
    // Best-effort persistence — a failed write still applies the choice for
    // the rest of this session, it just won't survive an app restart.
    SecureStore.setItemAsync(PREF_KEY, next).catch(() => undefined);
  }

  function setGround(next: GroundName) {
    touched.current.ground = true;
    setLook((cur) => ({ ...cur, ground: next }));
    SecureStore.setItemAsync(GROUND_KEY, next).catch(() => undefined);
  }

  function setAccent(next: AccentName) {
    touched.current.accent = true;
    setLook((cur) => ({ ...cur, accent: next }));
    SecureStore.setItemAsync(ACCENT_KEY, next).catch(() => undefined);
  }

  // The brand only reaches the tokens under 'My school'; for a named accent a
  // brand landing late must not rebuild the palette (and re-render the app).
  const brandInUse = accent === 'school' ? brand : null;

  const scheme: ColorScheme =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      scheme,
      preference,
      setPreference,
      ground,
      setGround,
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
        // INK & LIT (19 Oct 2026): the chosen palette paints every role; the
        // ground keeps the paper only when the person chose one.
        color: applyInkLit(applyGround(palette[scheme], GROUNDS[ground][scheme]), rolesFor(accent, scheme, brandInUse), ground === 'fresh'),
        gap: GAP,
        radius: RADIUS,
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheme, preference, brandInUse, ground, accent],
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
