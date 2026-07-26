import { Stack } from 'expo-router';
import { ScrollView, Text, View, Pressable } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';

/**
 * Root error boundary. Expo Router renders this instead of the route tree when
 * a child throws during render, so a JS error shows a readable screen with the
 * message (and a Try again button) rather than a blank screen or a hard crash.
 * It catches React render errors only — native-module / startup crashes are
 * caught by Sentry once EXPO_PUBLIC_SENTRY_DSN is configured.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, backgroundColor: '#0b1220', padding: 24, justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 8 }}>
        Something went wrong
      </Text>
      <Text style={{ color: '#9fb3c8', marginBottom: 16 }}>
        The app hit an unexpected error. You can try again, and if it keeps
        happening, please let your school know.
      </Text>
      <ScrollView
        style={{ maxHeight: 220, backgroundColor: '#111a2b', borderRadius: 10, padding: 12, marginBottom: 20 }}
      >
        <Text selectable style={{ color: '#ff8f8f', fontFamily: 'monospace', fontSize: 12 }}>
          {error?.message}
          {error?.stack ? `\n\n${error.stack}` : ''}
        </Text>
      </ScrollView>
      <Pressable
        onPress={retry}
        style={{ backgroundColor: '#4F46E5', paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}
      >
        <Text style={{ color: '#fff', fontWeight: '700' }}>Try again</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
