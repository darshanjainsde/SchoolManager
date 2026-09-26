import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSchoolDto } from './owner.dto';

const base = { name: 'Maple Leaf Academy', slug: 'maple-leaf', tier: 'STANDARD', domainHostname: 'maple.test', adminEmail: 'admin@maple.test' };

describe('CreateSchoolDto — the country switch is set at birth', () => {
  it('accepts a real ISO country', async () => {
    const errors = await validate(plainToInstance(CreateSchoolDto, { ...base, countryCode: 'AE' }));
    expect(errors).toEqual([]);
  });
  it('is optional, so an owner console deployed before the field still creates schools', async () => {
    const errors = await validate(plainToInstance(CreateSchoolDto, base));
    expect(errors).toEqual([]);
  });
  it.each(['XX', 'EU', 'in', 'IND', ''])('rejects %p — a typo must not become a school’s country forever', async (bad) => {
    const errors = await validate(plainToInstance(CreateSchoolDto, { ...base, countryCode: bad }));
    expect(errors.some((e) => e.property === 'countryCode')).toBe(true);
  });
});
