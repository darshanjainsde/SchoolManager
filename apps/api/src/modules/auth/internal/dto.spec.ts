import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './dto';

describe('LoginDto', () => {
  it('fails validation when identifier is a non-string, even with email also present', async () => {
    const dto = plainToInstance(LoginDto, {
      identifier: 123,
      email: 'someone@example.com',
      password: 'x',
    });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'identifier')).toBe(true);
  });

  it('fails validation when identifier is a non-string and email is absent', async () => {
    const dto = plainToInstance(LoginDto, {
      identifier: 123,
      password: 'x',
    });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'identifier')).toBe(true);
  });

  it('fails validation when neither identifier nor email is present', async () => {
    const dto = plainToInstance(LoginDto, {
      password: 'x',
    });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'identifierOrEmail')).toBe(true);
  });

  it('passes validation with a valid string identifier and password', async () => {
    const dto = plainToInstance(LoginDto, {
      identifier: 'SUN-1',
      password: 'x',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('passes validation with a valid string email and password', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'someone@example.com',
      password: 'x',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
