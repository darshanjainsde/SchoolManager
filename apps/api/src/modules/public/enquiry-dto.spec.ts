import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateDeskEnquiryDto, SubmitEnquiryDto } from './public.dto';

const failed = (cls: new () => object, body: Record<string, unknown>) =>
  validateSync(plainToInstance(cls, body)).map((e) => e.property);

describe.each([
  ['the website form', SubmitEnquiryDto, {}],
  ['the desk', CreateDeskEnquiryDto, { source: 'WALK_IN' }],
])('%s refuses a blank name or a phone with no number', (_door, cls, base) => {
  it('takes a real name and phone', () => {
    expect(failed(cls, { ...base, parentName: 'Sneha Kulkarni', phone: '98123 00011' })).toEqual([]);
  });

  it.each(['   ', '\t'])('refuses a name of only spaces (%j) — trimming would store it as empty', (parentName) => {
    expect(failed(cls, { ...base, parentName, phone: '98123 00011' })).toContain('parentName');
  });

  it.each(['   ', 'call me', '+-'])('refuses a phone with no digit (%j)', (phone) => {
    expect(failed(cls, { ...base, parentName: 'Sneha', phone })).toContain('phone');
  });
});
