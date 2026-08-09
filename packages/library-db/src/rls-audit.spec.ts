import { auditRlsCoverage } from './rls-audit';
import { getLibraryPlatformPrisma, disconnectLibrary } from './index';

const live = Boolean(process.env.LIBRARY_DATABASE_URL_PLATFORM);
const describeLive = live ? describe : describe.skip;

describeLive('RLS coverage audit', () => {
  afterAll(async () => { await disconnectLibrary(); });

  it('reports every orgId-bearing table as forced and policied', async () => {
    const result = await auditRlsCoverage(getLibraryPlatformPrisma());
    expect(result.unprotected).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('allow-lists exactly the three hash-keyed token tables', async () => {
    const result = await auditRlsCoverage(getLibraryPlatformPrisma());
    expect(result.allowListed.sort()).toEqual(
      ['PasswordResetToken', 'RefreshToken', 'RegistrationToken'].sort(),
    );
  });
});
