// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { schoolJsonLd } from './school-jsonld';

const profile = {
  logoUrl: 'https://cdn.example/logo.png',
  phone: '+91 80 4123 5678',
  email: 'info@raffles.edu',
  addressLine1: '12 Residency Road',
  addressLine2: null,
  city: 'Bengaluru',
  region: 'Karnataka',
  postalCode: '560025',
  country: null,
} as never;

describe('schoolJsonLd', () => {
  it('emits a School with the facts the school entered', () => {
    const ld = schoolJsonLd('raffles.sckools.com', { school: { name: 'Raffles Primary School' } as never, profile });
    expect(ld['@type']).toBe('School');
    expect(ld.url).toBe('https://raffles.sckools.com/');
    expect(ld.telephone).toBe('+91 80 4123 5678');
    expect(ld.address).toMatchObject({ addressLocality: 'Bengaluru', postalCode: '560025', addressCountry: 'IN' });
  });
  it('never invents an address or phone', () => {
    const ld = schoolJsonLd('x.sckools.com:3000', { school: { name: 'X' } as never, profile: { logoUrl: null } as never });
    expect(ld.url).toBe('https://x.sckools.com/');
    expect('address' in ld).toBe(false);
    expect('telephone' in ld).toBe(false);
  });
});
