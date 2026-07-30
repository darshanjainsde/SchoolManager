import { Stack } from 'expo-router';
import { ScrollView, Text, View, Pressable } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import * as Sentry from '@sentry/react-native';
import { ThemeProvider } from '@/theme/theme-context';
import { emergency } from '@/theme/tokens';

// Initialise crash reporting as early as possible so a launch crash is
// captured. The DSN is a public client key supplied via app config
// (extra.sentryDsn). Native + JS crashes report to the Sckools Sentry org.
Sentry.init({
  dsn: Constants.expoConfig?.extra?.sentryDsn as string | undefined,
  // While stabilising the first release, capture everything.
  tracesSampleRate: 1.0,
  enableNativeCrashHandling: true,
});

/**
 * Root error boundary. Expo Router renders this instead of the route tree when
 * a child throws during render, so a JS error shows a readable screen with the
 * message (and a Try again button) rather than a blank screen or a hard crash.
 * It catches React render errors only — native-module / startup crashes are
 * caught by Sentry once EXPO_PUBLIC_SENTRY_DSN is configured.
 */
// Renders in place of the whole route tree — including <ThemeProvider> below
// — when a child throws, so it deliberately does NOT read theme context and
// uses its own small fixed palette (`emergency` in theme/tokens.ts) instead.
// Always dark, on purpose: max legibility for a crash screen regardless of
// device theme or whatever state the app was in when it broke.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, backgroundColor: emergency.bg, padding: 24, justifyContent: 'center' }}>
      <Text style={{ color: emergency.ink, fontSize: 20, fontWeight: '800', marginBottom: 8 }}>
        Something went wrong
      </Text>
      <Text style={{ color: emergency.sub, marginBottom: 16 }}>
        The app hit an unexpected error. You can try again, and if it keeps
        happening, please let your school know.
      </Text>
      <ScrollView
        style={{ maxHeight: 220, backgroundColor: emergency.panel, borderRadius: 10, padding: 12, marginBottom: 20 }}
      >
        <Text selectable style={{ color: emergency.danger, fontFamily: 'monospace', fontSize: 12 }}>
          {error?.message}
          {error?.stack ? `\n\n${error.stack}` : ''}
        </Text>
      </ScrollView>
      <Pressable
        onPress={retry}
        style={{ backgroundColor: emergency.cta, paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}
      >
        <Text style={{ color: emergency.ink, fontWeight: '700' }}>Try again</Text>
      </Pressable>
    </View>
  );
}

function RootLayout() {
  // Bundle + load the Ionicons glyph font used by the tab bars. Without this,
  // release builds render tab icons as missing-glyph "tofu" boxes. Render once
  // loaded (or if loading errors — never block the app on a font).
  const [fontsLoaded, fontError] = useFonts(Ionicons.font);
  if (!fontsLoaded && !fontError) return null;
  return (
    <ThemeProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}

// Sentry.wrap enables native error boundary + performance tracking on the root.
export default Sentry.wrap(RootLayout);
