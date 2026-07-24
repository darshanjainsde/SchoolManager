import { IsIn, IsString, Length } from 'class-validator';

export class RegisterPushTokenDto {
  /** Expo push tokens look like `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`. */
  @IsString()
  @Length(10, 300)
  token!: string;

  @IsIn(['android', 'ios'])
  platform!: 'android' | 'ios';
}
