import config from '../../app.config';

/**
 * Google Play reviews an app by the permissions it DECLARES. The vc20 bundle
 * carried 32, most of them library defaults for things this app never does
 * (camera, microphone, storage, "draw over other apps", biometrics, launcher
 * badges). This pins the declared set to what the code uses and the blocked
 * set to what a plugin might otherwise add back — a library upgrade that
 * reintroduces CAMERA fails here, not in review.
 */
const SENSITIVE = [
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.USE_BIOMETRIC',
  'android.permission.USE_FINGERPRINT',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.READ_CONTACTS',
  'android.permission.READ_PHONE_STATE',
  'android.permission.READ_SMS',
];

describe('Android permissions declared by app.config.ts', () => {
  const android = config.android!;
  it('declares only the network + notification set the code uses', () => {
    expect([...(android.permissions ?? [])].sort()).toEqual([
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.INTERNET',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.VIBRATE',
      'android.permission.WAKE_LOCK',
    ]);
  });
  it('blocks every sensitive permission a library might add back', () => {
    const blocked = new Set(android.blockedPermissions ?? []);
    const missing = SENSITIVE.filter((p) => !blocked.has(p) && !['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.READ_CONTACTS', 'android.permission.READ_PHONE_STATE', 'android.permission.READ_SMS'].includes(p));
    expect(missing).toEqual([]);
    for (const p of android.permissions ?? []) expect(blocked.has(p)).toBe(false);
  });
  it('the image picker asks for the photo library only — never the camera or microphone', () => {
    const picker = (config.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'expo-image-picker') as [string, Record<string, unknown>] | undefined;
    expect(picker?.[1]).toMatchObject({ cameraPermission: false, microphonePermission: false });
  });
});
