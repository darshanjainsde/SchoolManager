import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterPushTokenDto } from './portal.dto';

describe('RegisterPushTokenDto', () => {
  it('passes validation with a valid Expo token and platform', async () => {
    const dto = plainToInstance(RegisterPushTokenDto, {
      token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
      platform: 'ios',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('fails validation when platform is not android or ios', async () => {
    const dto = plainToInstance(RegisterPushTokenDto, {
      token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
      platform: 'windows',
    });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'platform')).toBe(true);
  });

  it('fails validation when platform is missing', async () => {
    const dto = plainToInstance(RegisterPushTokenDto, {
      token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
    });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'platform')).toBe(true);
  });

  it('fails validation when token is missing', async () => {
    const dto = plainToInstance(RegisterPushTokenDto, {
      platform: 'android',
    });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'token')).toBe(true);
  });

  it('fails validation when token is shorter than 10 characters', async () => {
    const dto = plainToInstance(RegisterPushTokenDto, {
      token: 'short',
      platform: 'android',
    });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'token')).toBe(true);
  });

  it('fails validation when token is a non-string', async () => {
    const dto = plainToInstance(RegisterPushTokenDto, {
      token: 12345678901,
      platform: 'android',
    });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'token')).toBe(true);
  });
});
