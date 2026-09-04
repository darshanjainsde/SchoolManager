/**
 * An impersonated session's `sub` is the school ADMIN, because that is whose
 * account the operator is standing in. Without extra marking, every action a
 * platform operator takes inside a school is recorded as that admin's own
 * work — flagged by the 4 Sept 2026 audit. The `imp` claim already existed but
 * was read only by the browser, to draw a banner.
 */
type Rec = { actorUserId: string | null; meta?: Record<string, unknown> };

/** The interceptor's decision, extracted so it can be asserted directly. */
function auditMeta(user: { sub: string; imp?: boolean; impBy?: string } | undefined): Rec {
  const impersonated = user?.imp === true;
  const impersonatedBy = user?.impBy;
  return {
    actorUserId: user?.sub ?? null,
    meta: impersonated ? { impersonated: true, impersonatedBy: impersonatedBy ?? null } : undefined,
  };
}

describe('audit attribution during impersonation', () => {
  it('adds no meta for an ordinary session', () => {
    expect(auditMeta({ sub: 'admin-1' })).toEqual({ actorUserId: 'admin-1', meta: undefined });
  });

  it('marks an impersonated action, so it cannot be read as the admin’s own', () => {
    const rec = auditMeta({ sub: 'admin-1', imp: true, impBy: 'owner-9' });
    expect(rec.meta).toEqual({ impersonated: true, impersonatedBy: 'owner-9' });
  });

  it('still names the account acted through, because that is what changed', () => {
    expect(auditMeta({ sub: 'admin-1', imp: true, impBy: 'owner-9' }).actorUserId).toBe('admin-1');
  });

  it('records the impersonation even when the operator is unknown', () => {
    // Links minted before attribution existed carry no impBy. Saying
    // "impersonated by nobody recorded" beats saying nothing at all.
    const rec = auditMeta({ sub: 'admin-1', imp: true });
    expect(rec.meta).toEqual({ impersonated: true, impersonatedBy: null });
  });
});
