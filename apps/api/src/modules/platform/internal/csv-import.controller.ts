import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import Papa from 'papaparse';
import { getPlatformPrisma, UserRole } from '@skoolos/db';
import { PasswordService } from '../../auth';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import { PlatformHostGuard } from './platform-host.guard';
import { randomBytes } from 'node:crypto';

type ImportRole = 'TEACHER' | 'STUDENT';
type Row = { email: string; firstName: string; lastName: string };
type ParsedRow = { ok: true; row: Row } | { ok: false; reason: string; raw: Record<string, string> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * CSV bulk import — preview-then-commit:
 *   POST /platform/schools/:id/imports/preview?role=TEACHER  (multipart CSV)
 *     → returns parsed rows with per-row validation errors, no DB writes
 *   POST /platform/schools/:id/imports/commit?role=TEACHER   (multipart CSV)
 *     → re-validates, then writes valid rows
 *   GET  /platform/imports/template?role=TEACHER             (download)
 */
@ApiTags('platform-csv-import')
@ApiBearerAuth()
@UseGuards(PlatformHostGuard, PlatformJwtGuard)
@Controller('platform')
export class CsvImportController {
  constructor(private readonly passwords: PasswordService) {}

  @Get('imports/template')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="users-template.csv"')
  template() {
    return 'email,firstName,lastName\nada@example.com,Ada,Lovelace\n';
  }

  @Post('schools/:schoolId/imports/preview')
  @UseInterceptors(FileInterceptor('file'))
  async preview(
    @Param('schoolId') schoolId: string,
    @Query('role') role: ImportRole,
    @UploadedFile() file: Express.Multer.File,
  ) {
    assertRole(role);
    return this.parse(file, await existingEmails(schoolId));
  }

  @Post('schools/:schoolId/imports/commit')
  @UseInterceptors(FileInterceptor('file'))
  async commit(
    @Param('schoolId') schoolId: string,
    @Query('role') role: ImportRole,
    @UploadedFile() file: Express.Multer.File,
  ) {
    assertRole(role);
    const existing = await existingEmails(schoolId);
    const parsed = this.parse(file, existing);
    const validRows = parsed.rows.filter((r): r is { ok: true; row: Row } => r.ok).map((r) => r.row);

    // One placeholder password per user — they pick their real one on first login.
    const placeholder = await this.passwords.hash(randomBytes(32).toString('hex'));
    const created = await getPlatformPrisma().$transaction(
      validRows.map((row) =>
        getPlatformPrisma().user.create({
          data: {
            schoolId,
            email: row.email,
            role: role as UserRole,
            firstName: row.firstName,
            lastName: row.lastName,
            passwordHash: placeholder,
            isActive: true,
          },
        }),
      ),
    );

    return {
      preview: parsed,
      created: created.length,
      createdIds: created.map((u) => u.id),
    };
  }

  // ── parsing ──────────────────────────────────────────────────────────────
  @Post('schools/:schoolId/imports/preview-json')
  async previewJson(
    @Param('schoolId') schoolId: string,
    @Query('role') role: ImportRole,
    @Body() body: { csv: string },
  ) {
    assertRole(role);
    if (!body.csv) throw new BadRequestException('csv field required');
    const fake = { buffer: Buffer.from(body.csv, 'utf8') } as Express.Multer.File;
    return this.parse(fake, await existingEmails(schoolId));
  }

  private parse(
    file: Express.Multer.File | undefined,
    existing: Set<string>,
  ): { rows: ParsedRow[]; validCount: number; invalidCount: number } {
    if (!file?.buffer) throw new BadRequestException('CSV file required');
    const text = file.buffer.toString('utf8');
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });
    if (parsed.errors.length > 0) {
      throw new BadRequestException(`CSV parse error: ${parsed.errors[0].message}`);
    }
    const seenInBatch = new Set<string>();
    const rows: ParsedRow[] = parsed.data.map((raw) => {
      const email = (raw.email ?? '').trim().toLowerCase();
      const firstName = (raw.firstName ?? raw.first_name ?? '').trim();
      const lastName = (raw.lastName ?? raw.last_name ?? '').trim();
      if (!email || !EMAIL_RE.test(email)) {
        return { ok: false, reason: 'invalid email', raw };
      }
      if (!firstName || !lastName) {
        return { ok: false, reason: 'firstName/lastName required', raw };
      }
      if (existing.has(email)) return { ok: false, reason: 'email already exists', raw };
      if (seenInBatch.has(email)) return { ok: false, reason: 'duplicate in CSV', raw };
      seenInBatch.add(email);
      return { ok: true, row: { email, firstName, lastName } };
    });
    return {
      rows,
      validCount: rows.filter((r) => r.ok).length,
      invalidCount: rows.filter((r) => !r.ok).length,
    };
  }
}

function assertRole(role: ImportRole): void {
  if (role !== 'TEACHER' && role !== 'STUDENT') {
    throw new BadRequestException('role must be TEACHER or STUDENT');
  }
}

async function existingEmails(schoolId: string): Promise<Set<string>> {
  const rows = await getPlatformPrisma().user.findMany({
    where: { schoolId },
    select: { email: true },
  });
  return new Set(rows.map((r) => r.email));
}
