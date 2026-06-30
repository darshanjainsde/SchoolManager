import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class FeeItemDto {
  @ApiProperty() @IsString() @Length(1, 100) label!: string;
  @ApiProperty() @IsNumber() @Min(0) amount!: number;
  @ApiProperty() @IsDateString() dueDate!: string;
}

export class CreateFeeStructureDto {
  @ApiProperty() @IsString() @Length(1, 100) name!: string;
  @ApiProperty() @IsUUID() academicYearId!: string;
  @ApiProperty() @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
  @ApiProperty({ type: [FeeItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FeeItemDto)
  items!: FeeItemDto[];
}

export class AssignFeePlanDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  studentUserIds!: string[];
}

export class GenerateInvoicesDto {
  @ApiProperty() @IsUUID() feeStructureId!: string;
}

export class RecordPaymentDto {
  @ApiProperty() @IsNumber() @Min(0.01) amount!: number;
  @ApiProperty({ enum: ['CARD', 'BANK', 'CASH', 'OTHER'] })
  @IsEnum(['CARD', 'BANK', 'CASH', 'OTHER'])
  method!: 'CARD' | 'BANK' | 'CASH' | 'OTHER';
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class StartCheckoutDto {
  @ApiPropertyOptional() @IsOptional() @IsString() successUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cancelUrl?: string;
}
