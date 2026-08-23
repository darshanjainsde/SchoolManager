import 'reflect-metadata';

const schoolFindUnique = jest.fn();
const assetFindFirst = jest.fn();

jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  getPlatformPrisma: () => ({
    school: { findUnique: schoolFindUnique },
    mediaAsset: { findFirst: assetFindFirst },
  }),
}));

import { MailIdentityService } from './mail-identity.service';
import { encryptSecret } from './secret-box';

const SCHOOL_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function schoolRow(emailSettings: Record<string, unknown> | null) {
  return {
    name: 'Raffles Primary School',
    slug: 'raffles',
    emailSettings,
    profile: { logoAssetId: null, brandColorPrimary: '#1c4ea0' },
    domains: [{ hostname: 'raffles.sckools.com' }],
  };
}

/** A saved-and-verified own sender, the only shape that switches a school over. */
function customSender(overrides: Record<string, unknown> = {}) {
  return {
    senderMode: 'CUSTOM',
    senderStatus: 'VERIFIED',
    fromAddress: 'office@rafflesprimary.in',
    smtpHost: 'smtp.rafflesprimary.in',
    smtpPort: 587,
    smtpUser: 'office@rafflesprimary.in',
    smtpPassEnc: encryptSecret('hunter2'),
    senderName: null,
    replyTo: null,
    template: 'CLASSIC',
    accentColor: null,
    logoAssetId: null,
    footerLines: [],
    ...overrides,
  };
}

describe('MailIdentityService', () => {
  let svc: MailIdentityService;

  beforeEach(() => {
    jest.clearAllMocks();
    // A key must exist for the encrypt/decrypt round-trip cases; without one
    // the custom-sender path is unreachable by design.
    process.env.EMAIL_SECRET_KEY = Buffer.alloc(32, 7).toString('base64');
    svc = new MailIdentityService();
  });

  it('brands an UNCONFIGURED school from its website identity and sends via the platform', async () => {
    schoolFindUnique.mockResolvedValue(schoolRow(null));

    const id = await svc.forSchool(SCHOOL_ID);

    expect(id.brand.schoolName).toBe('Raffles Primary School');
    expect(id.brand.accent).toBe('#1c4ea0');
    expect(id.brand.siteHost).toBe('raffles.sckools.com');
    // The whole promise of the fallback: the school's name is on the envelope
    // even though the platform mailbox carries it.
    expect(id.from.name).toBe('Raffles Primary School');
    expect(id.usingCustomSender).toBe(false);
    expect(id.brand.showPlatformCredit).toBe(true);
  });

  it('uses the school’s own sender once it is CUSTOM + VERIFIED, and drops the platform credit', async () => {
    schoolFindUnique.mockResolvedValue(schoolRow(customSender()));

    const id = await svc.forSchool(SCHOOL_ID);

    expect(id.usingCustomSender).toBe(true);
    expect(id.from.address).toBe('office@rafflesprimary.in');
    expect(id.brand.showPlatformCredit).toBe(false);
  });

  it('does NOT use a saved-but-unverified sender', async () => {
    schoolFindUnique.mockResolvedValue(
      schoolRow(customSender({ senderMode: 'DEFAULT', senderStatus: 'UNVERIFIED' })),
    );

    const id = await svc.forSchool(SCHOOL_ID);

    expect(id.usingCustomSender).toBe(false);
    expect(id.from.address).toBe('test@test.invalid'); // the platform mailbox
  });

  it('falls back to the platform when a verified sender is marked FAILING', async () => {
    schoolFindUnique.mockResolvedValue(schoolRow(customSender({ senderStatus: 'FAILING' })));

    const id = await svc.forSchool(SCHOOL_ID);

    expect(id.usingCustomSender).toBe(false);
  });

  it('falls back rather than sending nothing when the stored password cannot be decrypted', async () => {
    // What a restored backup or a rotated key looks like in production.
    schoolFindUnique.mockResolvedValue(schoolRow(customSender({ smtpPassEnc: 'v1.garbage.garbage.garbage' })));

    const id = await svc.forSchool(SCHOOL_ID);

    expect(id.usingCustomSender).toBe(false);
    expect(id.from.name).toBe('Raffles Primary School');
  });

  it('honours senderName and replyTo overrides', async () => {
    schoolFindUnique.mockResolvedValue(
      schoolRow({ ...customSender({ senderMode: 'DEFAULT' }), senderName: 'Raffles Office', replyTo: 'office@x.in' }),
    );

    const id = await svc.forSchool(SCHOOL_ID);

    expect(id.from.name).toBe('Raffles Office');
    expect(id.replyTo).toBe('office@x.in');
  });

  it('returns a working platform identity when the school lookup throws', async () => {
    // Branding is a nicety; delivery is not.
    schoolFindUnique.mockRejectedValue(new Error('db down'));

    const id = await svc.forSchool(SCHOOL_ID);

    expect(id.brand.schoolName).toBe('Sckools');
    expect(id.usingCustomSender).toBe(false);
  });

  it('caches per school and re-reads after invalidate', async () => {
    schoolFindUnique.mockResolvedValue(schoolRow(null));

    await svc.forSchool(SCHOOL_ID);
    await svc.forSchool(SCHOOL_ID);
    // A 300-family announcement must not become 300 identical lookups.
    expect(schoolFindUnique).toHaveBeenCalledTimes(1);

    svc.invalidate(SCHOOL_ID);
    await svc.forSchool(SCHOOL_ID);
    expect(schoolFindUnique).toHaveBeenCalledTimes(2);
  });

  it('needs no school at all for platform mail', async () => {
    const id = await svc.forSchool(null);
    expect(id.brand.schoolName).toBe('Sckools');
    expect(schoolFindUnique).not.toHaveBeenCalled();
  });
});
