import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { GAP, RADIUS, palette, type ColorPalette, type ColorScheme } from './tokens';

export type ThemePreference = 'system' | ColorScheme;

// Not sensitive — reuses expo-secure-store (already a dependency, see
// `src/lib/session.ts`) rather than adding an AsyncStorage-equivalent
// dependency purely for a UI preference.
const PREF_KEY = 'sckools.themePreference';

function isThemePreference(v: string | null): v is ThemePreference {
  return v === 'system' || v === 'light' || v === 'dark';
}

interface ThemeContextValue {
  /** Resolved scheme actually in effect right now. */
  scheme: ColorScheme;
  /** The user's stated choice — 'system' means "follow the OS". */
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
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
  tokens: { color: palette.light, gap: GAP, radius: RADIUS },
};

const ThemeContext = createContext<ThemeContextValue>(defaultThemeContext);

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null | undefined
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(PREF_KEY).then((stored) => {
      if (!cancelled && isThemePreference(stored)) setPreferenceState(stored);
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

  const scheme: ColorScheme =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      scheme,
      preference,
      setPreference,
      tokens: { color: palette[scheme], gap: GAP, radius: RADIUS },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheme, preference],
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
