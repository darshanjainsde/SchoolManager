import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateAnnouncementDto {
  @ApiProperty() @IsString() @Length(1, 200) title!: string;
  @ApiProperty() @IsString() @Length(1, 10_000) body!: string;
  @ApiProperty({ enum: ['SCHOOL', 'ROLE', 'CLASS', 'USER'] })
  @IsEnum(['SCHOOL', 'ROLE', 'CLASS', 'USER'])
  audience!: 'SCHOOL' | 'ROLE' | 'CLASS' | 'USER';
  @ApiPropertyOptional({ enum: ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'STAFF'] })
  @IsOptional()
  @IsEnum(['SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'STAFF'])
  audienceRole?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() audienceClassId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() audienceUserId?: string;
}

export class SendMessageDto {
  @ApiProperty() @IsUUID() toUserId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() threadId?: string;
  @ApiProperty() @IsString() @Length(1, 5_000) body!: string;
}
