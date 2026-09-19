import { promises as dns } from 'node:dns';
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { getPlatformPrisma } from '@skoolos/db';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { checkEmail, emailVerdictWords, type EmailVerdict } from '../../common/mail/email-check';

export class EmailCheckDto {
  @IsString()
  @MaxLength(254)
  email!: string;
}

/**
 * "Will this address take mail?" for the office, as it types. Advisory: the
 * form warns and lets the office decide — the house rule is warn, not block.
 * Admins and teachers (a teacher enters a family's email on admission forms).
 */
@Controller('manage/email-check')
@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('SCHOOL_ADMIN', 'TEACHER')
export class EmailCheckController {
  @Post()
  @HttpCode(200)
  async check(@Body() dto: EmailCheckDto): Promise<EmailVerdict & { words: string }> {
    const verdict = await checkEmail(dto.email, {
      dns: { resolveMx: (d) => dns.resolveMx(d), resolve4: (d) => dns.resolve4(d) },
      // Suppression is platform-wide by address (a dead mailbox is dead for
      // every school); the platform client is the right one, and the answer
      // reveals only that WE have seen it bounce, never which school.
      isSuppressed: async (email) => {
        try {
          const row = await getPlatformPrisma().emailSuppression.findUnique({ where: { email }, select: { reason: true, detail: true } });
          return row ?? null;
        } catch {
          return null;
        }
      },
    });
    return { ...verdict, words: emailVerdictWords(verdict) };
  }
}
