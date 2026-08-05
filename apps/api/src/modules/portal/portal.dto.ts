import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

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

/**
 * How many seats a signed-in family is taking. Deliberately the ONLY thing this
 * request may say: who is registering comes from the JWT, and the event from
 * the path — there is no field here that could file the place as somebody else.
 */
export class RegisterForEventDto {
  @IsOptional() @IsInt() @Min(1) @Max(20) quantity?: number;
}
