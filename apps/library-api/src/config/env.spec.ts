import { loadLibraryEnv } from './env';

describe('loadLibraryEnv', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });

  it('accepts the test environment', () => {
    const env = loadLibraryEnv();
    expect(env.LIBRARY_PLATFORM_HOST).toBe('library.trackyour.in');
    expect(env.NODE_ENV).toBe('test');
  });

  it('refuses to boot without a database url', () => {
    delete process.env.LIBRARY_DATABASE_URL_APP;
    delete process.env.LIBRARY_DATABASE_URL;
    expect(() => loadLibraryEnv({ force: true })).toThrow(/LIBRARY_DATABASE_URL_APP/);
  });

  it('refuses a jwt secret shorter than 32 characters', () => {
    process.env.LIBRARY_JWT_SECRET = 'too-short';
    expect(() => loadLibraryEnv({ force: true })).toThrow(/LIBRARY_JWT_SECRET/);
  });
});
