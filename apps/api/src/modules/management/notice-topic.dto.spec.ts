import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { CreateAnnouncementDto } from './management.dto';

// The same options as the global pipe in app.module.ts.
const check = (body: object): ValidationError[] =>
  validateSync(plainToInstance(CreateAnnouncementDto, body), { whitelist: true, forbidNonWhitelisted: true });
const base = { title: 'Notice', body: 'Words.' };
const onTopic = (errs: ValidationError[]) => errs.some((e) => e.property === 'topic');

describe('CreateAnnouncementDto.topic (the gate before the service)', () => {
  it('a notice with no topic is fine', () => expect(check(base)).toHaveLength(0));
  it('a valid HOLIDAY passes', () => {
    expect(check({ ...base, topic: { kind: 'HOLIDAY', closedOn: '2026-10-20', occasion: 'Diwali', resumesOn: '2026-10-23' } })).toHaveLength(0);
  });
  it('a valid PTM and TIMING pass', () => {
    expect(check({ ...base, topic: { kind: 'PTM', on: '2026-10-11', at: '10:00' } })).toHaveLength(0);
    expect(check({ ...base, topic: { kind: 'TIMING', on: '2026-10-13', from: '08:00', to: '12:30' } })).toHaveLength(0);
  });
  it('a PTM without its time is refused', () => {
    expect(onTopic(check({ ...base, topic: { kind: 'PTM', on: '2026-10-11' } }))).toBe(true);
  });
  it('an unknown kind is refused', () => {
    expect(onTopic(check({ ...base, topic: { kind: 'PARTY', on: '2026-10-11', at: '10:00' } }))).toBe(true);
  });
  it('an extra property inside topic is refused', () => {
    expect(onTopic(check({ ...base, topic: { kind: 'PTM', on: '2026-10-11', at: '10:00', secret: 'x' } }))).toBe(true);
  });
});
