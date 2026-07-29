import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SaveAttendanceDto } from './management.dto';

describe('SaveAttendanceDto', () => {
  it('passes validation with a plain YYYY-MM-DD date', async () => {
    const dto = plainToInstance(SaveAttendanceDto, {
      classSectionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      date: '2026-07-29',
      marks: [],
    });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'date')).toBe(false);
  });

  // `save()` string-compares `date` against `istTodayISO()`'s YYYY-MM-DD
  // output, so a full ISO timestamp (which shipping clients never send)
  // must be rejected here rather than sorting as a bogus "future date" 400
  // further down.
  it('rejects a full ISO timestamp instead of a plain YYYY-MM-DD date', async () => {
    const dto = plainToInstance(SaveAttendanceDto, {
      classSectionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      date: '2026-07-29T00:00:00.000Z',
      marks: [],
    });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'date')).toBe(true);
  });
});
