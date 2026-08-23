import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { MailModule } from './mail.module';
import { MailService } from './mail.service';
import { MailIdentityService } from './mail-identity.service';

/**
 * Bootstrap regression guard.
 *
 * A provider whose constructor parameter Nest cannot resolve does not fail
 * that provider — it aborts the ENTIRE application bootstrap, and every route
 * answers FUNCTION_INVOCATION_FAILED. This project has already lost a staging
 * environment to exactly that (see the throttler storage spec next door), and
 * unit tests never catch it because they build services with `new`.
 *
 * So the mail wing is compiled through the real injector here: if MailService
 * or MailIdentityService ever grows a parameter the container cannot satisfy,
 * this fails in CI instead of at 3am in production.
 */
describe('MailModule DI', () => {
  it('resolves every mail provider through the injector', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [MailModule] }).compile();

    expect(moduleRef.get(MailService)).toBeInstanceOf(MailService);
    expect(moduleRef.get(MailIdentityService)).toBeInstanceOf(MailIdentityService);

    // MailService must have actually RECEIVED its dependency, not merely
    // constructed with undefined — an unresolved optional would sail through
    // instantiation and only explode on the first email.
    const mail = moduleRef.get(MailService) as unknown as { identity: MailIdentityService };
    expect(mail.identity).toBeInstanceOf(MailIdentityService);

    await moduleRef.close();
  });
});
