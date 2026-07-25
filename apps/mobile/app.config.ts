import type { ExpoConfig } from 'expo/config';

// EAS project (owner: darshanjainsde's Expo account). Used for both EAS Build
// and EAS Update (OTA). If you ever recreate the EAS project, update this id.
const EAS_PROJECT_ID = 'ec023260-2258-4e70-a96f-a32bfe2908cf';

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
