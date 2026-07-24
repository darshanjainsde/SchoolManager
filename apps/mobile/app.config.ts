import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Sckools',
  slug: 'sckools',
  scheme: 'sckools',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  android: {
    package: 'com.sckools.app',
    adaptiveIcon: { backgroundColor: '#4F46E5' },
  },
  ios: { bundleIdentifier: 'com.sckools.app' },
  plugins: ['expo-router', 'expo-secure-store'],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000',
  },
};

export default config;
