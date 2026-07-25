import type { ExpoConfig } from 'expo/config';

// TODO(user): after running `eas init` (see docs/SHIP-MOBILE.md), replace
// this placeholder with the real EAS project ID it prints, in BOTH spots
// below (updates.url and extra.eas.projectId). `eas init` cannot safely
// rewrite a TypeScript app.config.ts, so this is a manual one-time edit.
const EAS_PROJECT_ID = 'REPLACE-WITH-EAS-PROJECT-ID';

const config: ExpoConfig = {
  name: 'Sckools',
  slug: 'sckools',
  scheme: 'sckools',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash.png',
    backgroundColor: '#F4F5FB',
    resizeMode: 'contain',
  },
  android: {
    package: 'com.sckools.app',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#4F46E5',
    },
  },
  ios: { bundleIdentifier: 'com.sckools.app' },
  plugins: ['expo-router', 'expo-secure-store'],
  // EAS Update (OTA JS/asset pushes without a Play Store release) — see
  // docs/SHIP-MOBILE.md "Daily OTA pushes to testers".
  updates: {
    url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
  },
  runtimeVersion: { policy: 'appVersion' },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000',
    eas: { projectId: EAS_PROJECT_ID },
  },
};

export default config;
