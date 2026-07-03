import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class OwnerLoginDto {
  @IsEmail() email!: string;
  @IsString() @Length(1, 200) password!: string;
  @Matches(/^\d{6}$/) totp!: string;
}

export class RefreshDto {
  @IsString() refreshToken!: string;
}
