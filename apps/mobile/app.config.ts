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
