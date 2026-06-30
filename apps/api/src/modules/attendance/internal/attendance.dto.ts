import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class AttendanceMarkDto {
  @ApiProperty() @IsUUID() enrollmentId!: string;

  @ApiProperty({ enum: ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] })
  @IsEnum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'])
  status!: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class BulkAttendanceDto {
  @ApiProperty() @IsUUID() classId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sectionId?: string;

  @ApiProperty({ example: '2026-09-01' })
  @IsISO8601()
  date!: string;

  @ApiProperty({ type: [AttendanceMarkDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AttendanceMarkDto)
  marks!: AttendanceMarkDto[];
}
