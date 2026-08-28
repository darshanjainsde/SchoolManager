import { PublicEventsService, PUBLIC_EVENT_CEILING } from './public-events.service';

/**
 * Event targeting replaced a binary SCHOOL/NETWORK flag where NETWORK meant
 * "every school on the platform, forever". Measured at 200 schools that made a
 * single public-site response 10,050 events and 3.16 MB, against a hard 4.5 MB
 * platform cap that returns an error rather than a slow page.
 *
 * These tests pin the two properties that matter: the page can never grow
 * without bound, and a school only sees events actually addressed to it.
 */
describe('public event audience', () => {
  const HOST = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  let captured: Record<string, unknown>;

  const tx = {
    event: {
      findMany: jest.fn(async (args: Record<string, unknown>) => {
        captured = args;
        return [];
      }),
    },
    eventTicketType: { findMany: jest.fn().mockResolvedValue([]) },
    eventRegistration: { findMany: jest.fn().mockResolvedValue([]) },
  } as never;

  const svc = new PublicEventsService();
  const orClauses = () =>
    (((captured.where as Record<string, unknown>).AND as Record<string, unknown>[])[1]
      .OR as Record<string, unknown>[]);

  beforeEach(() => jest.clearAllMocks());

  it('caps how many events one page can return, whatever the platform holds', async () => {
    await svc.forHost(tx, HOST, new Date(), 'Jaipur');
    expect(captured.take).toBe(PUBLIC_EVENT_CEILING);
    // Two orders of magnitude clear of the ~13,000-event payload cap.
    expect(PUBLIC_EVENT_CEILING).toBeLessThan(200);
  });

  it("always includes the school's own events, whatever their audience", async () => {
    await svc.forHost(tx, HOST, new Date(), 'Jaipur');
    expect(orClauses()).toContainEqual({ schoolId: HOST });
  });

  it('matches city-targeted events for the host city', async () => {
    await svc.forHost(tx, HOST, new Date(), 'Jaipur');
    expect(orClauses()).toContainEqual({ audienceKind: 'CITY', audienceCity: 'Jaipur' });
  });

  it('matches NO city events when the school has not filled in its address', async () => {
    await svc.forHost(tx, HOST, new Date(), null);
    // The dangerous failure would be matching every city, not none.
    expect(orClauses().some((c) => 'audienceCity' in c)).toBe(false);
  });

  it('ignores surrounding whitespace rather than silently missing matches', async () => {
    await svc.forHost(tx, HOST, new Date(), '  Jaipur  ');
    expect(orClauses()).toContainEqual({ audienceKind: 'CITY', audienceCity: 'Jaipur' });
  });

  it('includes events this school was explicitly invited to', async () => {
    await svc.forHost(tx, HOST, new Date(), 'Jaipur');
    expect(orClauses()).toContainEqual({ audienceSchools: { some: { schoolId: HOST } } });
  });

  it('keeps legacy EVERYWHERE events visible so nothing already published vanishes', async () => {
    await svc.forHost(tx, HOST, new Date(), 'Jaipur');
    expect(orClauses()).toContainEqual({ audienceKind: 'EVERYWHERE' });
  });

  it('never returns a draft or pending event', async () => {
    await svc.forHost(tx, HOST, new Date(), 'Jaipur');
    expect((captured.where as Record<string, unknown>).status).toBe('APPROVED');
  });
});
