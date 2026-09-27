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
    // PERMISSIONS ARE A REVIEW SURFACE. The vc20 bundle (dumped with
    // bundletool on 2026-09-22) declared 32 permissions, among them CAMERA,
    // RECORD_AUDIO, storage, SYSTEM_ALERT_WINDOW and biometrics — none used by
    // any line of this app (the profile photo goes through the system picker,
    // which needs no permission on Android 13+). They arrive as library
    // defaults (expo-image-picker, react-native dev support, expo-secure-store,
    // Expo's legacy defaults) and Google Play reviews an app by what it
    // DECLARES, not what it calls. Declare only what we use; block the rest
    // so no plugin can re-add it silently. Guarded by
    // src/__tests__/android-permissions.test.ts.
    permissions: [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.VIBRATE',
      'android.permission.WAKE_LOCK',
      'android.permission.RECEIVE_BOOT_COMPLETED',
    ],
    blockedPermissions: [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.USE_BIOMETRIC',
      'android.permission.USE_FINGERPRINT',
      'android.permission.READ_APP_BADGE',
      // Launcher badge counts on OEM launchers (ShortcutBadger via
      // expo-notifications). Fourteen vendor permissions for a number on an
      // icon we never set — off.
      'com.anddoes.launcher.permission.UPDATE_COUNT',
      'com.htc.launcher.permission.READ_SETTINGS',
      'com.htc.launcher.permission.UPDATE_SHORTCUT',
      'com.huawei.android.launcher.permission.CHANGE_BADGE',
      'com.huawei.android.launcher.permission.READ_SETTINGS',
      'com.huawei.android.launcher.permission.WRITE_SETTINGS',
      'com.majeur.launcher.permission.UPDATE_BADGE',
      'com.oppo.launcher.permission.READ_SETTINGS',
      'com.oppo.launcher.permission.WRITE_SETTINGS',
      'com.sec.android.provider.badge.permission.READ',
      'com.sec.android.provider.badge.permission.WRITE',
      'com.sonyericsson.home.permission.BROADCAST_BADGE',
      'com.sonymobile.home.permission.PROVIDER_INSERT_BADGE',
      'me.everything.badger.permission.BADGE_COUNT_READ',
      'me.everything.badger.permission.BADGE_COUNT_WRITE',
    ],
  },
  ios: { bundleIdentifier: 'com.sckools.app' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    // Profile-photo picker (Phase 5·0d). iOS needs the permission string;
    // Android 13+ uses the system Photo Picker (no permission required).
    [
      'expo-image-picker',
      {
        photosPermission: 'Sckools uses your photo library so you can set a profile picture.',
        // No camera in the app: the picker opens the library only. Without
        // this the plugin declares CAMERA + RECORD_AUDIO on Android.
        cameraPermission: false,
        microphonePermission: false,
      },
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
          // R8: shrink + obfuscate the release DEX. The vc20 bundle shipped
          // 20.7 MB of unminified DEX (Play Console: "DEX code optimization:
          // Low", obfuscation 2%). Expo modules and Sentry ship their own
          // consumer ProGuard rules, so this is supported — but it is the one
          // change that can break launch by stripping a class reflection
          // reaches for. RULE: after enabling, cut an `internal` APK, install
          // it on a real device and walk login → home → notifications →
          // profile photo BEFORE the next production bundle.
          enableProguardInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
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
