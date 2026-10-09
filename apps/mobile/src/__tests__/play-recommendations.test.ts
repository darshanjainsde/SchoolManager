import config from '../../app.config';

/**
 * Play Console "recommended actions" on release 24 (read 9 Oct 2026), pinned so
 * a config edit cannot quietly bring one back. The two that live in libraries
 * (deprecated status-bar calls in RN's StatusBarModule and react-native-screens;
 * expo-notifications decoding a notification image by hand) go away with the
 * Expo SDK 54 upgrade, not here. AGP 9 also needs that upgrade.
 */
describe('Play recommendations fixed in config', () => {
  it('no orientation lock — Android 16 ignores it on large screens and Play flags it', () => {
    expect(config.orientation).not.toBe('portrait');
    expect(config.orientation).not.toBe('landscape');
  });

  it('edge-to-edge is set explicitly, not left to the OS version', () => {
    expect(config.android?.edgeToEdgeEnabled).toBe(true);
  });

  it('R8 shrinks and obfuscates, but does NOT optimise — optimising broke every request (9 Oct 2026)', () => {
    const plugins = (config.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(plugins).not.toContain('./plugins/with-r8-optimize');
    const props = (config.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'expo-build-properties') as [string, { android: Record<string, unknown> }];
    expect(props[1].android.enableProguardInReleaseBuilds).toBe(true);
    expect(props[1].android.enableShrinkResourcesInReleaseBuilds).toBe(true);
  });
});
