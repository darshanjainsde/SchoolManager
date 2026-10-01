import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class StartRestoreDto {
  @IsUUID() backupId!: string;
  /** restore = the school is not on this server; replace = back up the current copy, remove it, restore. */
  @IsIn(['restore', 'replace']) mode!: 'restore' | 'replace';
  /** Import under another address. 2–32 lowercase letters, digits or dashes. */
  @IsOptional() @IsString() @Matches(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/) slug?: string;
  @IsIn(['LIVE', 'SUSPENDED', 'SETUP']) finalStatus!: 'LIVE' | 'SUSPENDED' | 'SETUP';
}

export class RegisterUploadDto {
  @IsString() @Matches(/^backups\/uploads\/[0-9a-f-]{36}\.sckools$/) key!: string;
}
