import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { CommonAuthModule } from '../../common/auth/auth.module';
import { MailModule } from '../../common/mail/mail.module';
import { StorageModule } from '../../common/storage/storage.module';
import { AuditModule } from '../../common/audit/audit.module';
import { PressModule } from './press.module';
import { ReportCardService } from './report-card.service';
import { CertificateService } from './certificate.service';
import { PressRegisterService } from './press-register.service';
import { PressOrdersService } from './press-orders.service';
import { OperatorOrdersService } from './operator-orders.service';

/**
 * Bootstrap regression guard, same shape as `mail-di.spec.ts`: one provider
 * the container cannot resolve aborts the ENTIRE application bootstrap and
 * every route answers FUNCTION_INVOCATION_FAILED. Unit tests build these
 * services with `new`, so only compiling the real module catches it.
 */
describe('PressModule DI', () => {
  it('resolves every press provider through the injector', async () => {
    // CommonAuthModule and MailModule are @Global() in the real app — guards
    // resolve JwtService and AuthModule's reset service resolves MailService
    // through them, so the compile needs both here too.
    const moduleRef = await Test.createTestingModule({
      // StorageModule is @Global() too — the order services upload and
      // presign through it.
      // AuditModule is @Global() too — the Result Room's override log rides it.
      imports: [CommonAuthModule, MailModule, StorageModule, AuditModule, PressModule],
    }).compile();

    expect(moduleRef.get(ReportCardService)).toBeInstanceOf(ReportCardService);
    expect(moduleRef.get(PressRegisterService)).toBeInstanceOf(PressRegisterService);

    // CertificateService must have RECEIVED its dependency, not merely
    // constructed with undefined.
    const certs = moduleRef.get(CertificateService) as unknown as { reportCards: ReportCardService };
    expect(certs).toBeInstanceOf(CertificateService);
    expect(certs.reportCards).toBeInstanceOf(ReportCardService);

    // The order services must have RECEIVED StorageService, not undefined.
    const orders = moduleRef.get(PressOrdersService) as unknown as { storage: unknown };
    expect(orders.storage).toBeDefined();
    const operator = moduleRef.get(OperatorOrdersService) as unknown as { storage: unknown };
    expect(operator.storage).toBeDefined();

    await moduleRef.close();
  });
});
