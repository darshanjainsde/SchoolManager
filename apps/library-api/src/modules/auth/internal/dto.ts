import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString() @MinLength(1) identifier!: string;
  @IsString() @MinLength(1) password!: string;
}

export class RefreshDto {
  @IsString() @MinLength(1) refreshToken!: string;
}

export class SckoolsExchangeDto {
  /** The token the user already holds from Sckools. Verified with a PUBLIC key
   *  — see SckoolsBridgeService for why it is never a shared secret. */
  @IsString() @MinLength(1) sckoolsToken!: string;
}
