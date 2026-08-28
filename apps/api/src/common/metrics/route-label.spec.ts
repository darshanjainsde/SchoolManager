import { routeLabel, capLabels, MAX_ROUTE_LABELS } from './route-label';

describe('routeLabel', () => {
  it('prefers the declared route pattern, which is already templated', () => {
    expect(routeLabel('GET', '/manage/students/:id', '/manage/students/abc')).toBe(
      'GET /manage/students/:id',
    );
  });

  it('templates uuids out of an unrouted url so each tenant is not its own series', () => {
    expect(
      routeLabel('GET', undefined, '/manage/attendance/2591a451-c283-4334-a62f-b60ebc79abd5'),
    ).toBe('GET /manage/attendance/:id');
  });

  it('drops the query string, which is unbounded by definition', () => {
    expect(routeLabel('GET', undefined, '/x?classSectionId=abc&date=2026-07-01')).toBe('GET /x');
  });

  it('templates long numeric ids but leaves short path segments alone', () => {
    expect(routeLabel('GET', undefined, '/alumni/batches/2014')).toBe('GET /alumni/batches/:n');
    expect(routeLabel('GET', undefined, '/v1/health')).toBe('GET /v1/health');
  });
});

describe('capLabels', () => {
  it('lets known labels through without growing the set', () => {
    const known = new Set(['GET /a']);
    expect(capLabels(known, 'GET /a')).toBe('GET /a');
    expect(known.size).toBe(1);
  });

  it('stops admitting new labels at the cap rather than growing without bound', () => {
    const known = new Set<string>();
    for (let i = 0; i < MAX_ROUTE_LABELS; i += 1) capLabels(known, `GET /r${i}`);
    expect(known.size).toBe(MAX_ROUTE_LABELS);
    expect(capLabels(known, 'GET /one-too-many')).toBeNull();
    // an already-known label still works after the cap is reached
    expect(capLabels(known, 'GET /r0')).toBe('GET /r0');
  });
});
