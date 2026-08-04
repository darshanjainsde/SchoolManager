import { IsIn, IsString, Length } from 'class-validator';

export class RegisterPushTokenDto {
  /** Expo push tokens look like `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`. */
  @IsString()
  @Length(10, 300)
  token!: string;

  @IsIn(['android', 'ios'])
  platform!: 'android' | 'ios';
}

/**
 * `POST /me/diary/:id/sign` — the signature in the margin of a red-ink remark
 * (Phase 5·3). Lives here, not in `management.dto.ts`, because it belongs to a
 * `/me` endpoint: a controller in this module importing a DTO out of another
 * module's internals is exactly what the module-boundary rule forbids (and
 * `pnpm preflight`'s dependency-cruiser step catches).
 */
export class SignDiaryEntryDto {
  @IsString()
  @Length(1, 80)
  signedName!: string;
}
