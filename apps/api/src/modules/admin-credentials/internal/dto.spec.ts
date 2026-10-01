import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ResetAdminPasswordDto } from './dto';

const errors = (body: object) => validateSync(plainToInstance(ResetAdminPasswordDto, body));

describe('ResetAdminPasswordDto', () => {
  it('accepts no password — the server generates one', () => {
    expect(errors({})).toHaveLength(0);
  });
  it('accepts a chosen password of 8 or more characters', () => {
    expect(errors({ password: 'eight-ch' })).toHaveLength(0);
  });
  it('refuses one shorter than 8, the floor every password path uses', () => {
    expect(errors({ password: 'short' })).not.toHaveLength(0);
  });
});
