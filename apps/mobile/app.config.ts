import type { ExpoConfig } from 'expo/config';

// EAS project (owner: darshanjainsde's Expo account). Used for both EAS Build
// and EAS Update (OTA). If you ever recreate the EAS project, update this id.
const EAS_PROJECT_ID = 'da9fa7e3-f87c-4d45-91c0-1c546418a52c';

const config: ExpoConfig = {
  name: 'Sckools',
  slug: 'sckools',
  owner: 'darshanjainsdes-team',
  scheme: 'sckools',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  // Opt OUT of the New Architecture (default-on in SDK 53). The app was only
  // unit-tested, never run on a device, and a native module that isn't
  // new-arch-ready crashes at launch — the most common cause of an
  // immediate release crash. The old architecture is stable and fully
  // supported; revisit enabling Fabric/TurboModules later, on a device.
  newArchEnabled: false,
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
  plugins: [
    'expo-router',
    'expo-secure-store',
    // Profile-photo picker (Phase 5·0d). iOS needs the permission string;
    // Android 13+ uses the system Photo Picker (no permission required).
    [
      'expo-image-picker',
      { photosPermission: 'Sckools uses your photo library so you can set a profile picture.' },
    ],
    '@sentry/react-native',
    // Google Play requires targeting Android 16 (API 36) from 2026-08-31.
    // Expo SDK 53 defaults to API 35, so bump compile+target here. AGP 8.8.2
    // (RN 0.79) can build against 36 (emits a "tested up to 35" warning).
    // Android requires compileSdkVersion >= targetSdkVersion, so both are 36.
    [
      'expo-build-properties',
      {
        android: {
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          buildToolsVersion: '36.0.0',
        },
      },
    ],
  ],
  // EAS Update (OTA JS/asset pushes without a Play Store release) — see
  // docs/SHIP-MOBILE.md "Daily OTA pushes to testers".
  updates: {
    url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
  },
  runtimeVersion: { policy: 'appVersion' },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000',
    // Sentry DSN is a public client key (safe to embed in the app). Env
    // override lets a build point at a different Sentry project if needed.
    sentryDsn:
      process.env.EXPO_PUBLIC_SENTRY_DSN ??
      'https://f260d44287d94e54008d429edf1d64e7@o4511800880398336.ingest.de.sentry.io/4511800888787024',
    eas: { projectId: EAS_PROJECT_ID },
  },
};

export default config;
