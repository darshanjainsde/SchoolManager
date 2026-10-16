import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { CommonAuthModule } from '../../common/auth/auth.module';
import { SyllabusModule } from './syllabus.module';
import { SyllabusService } from './syllabus.service';
import { SyllabusPortalService } from './syllabus-portal.service';

/**
 * Bootstrap regression guard (see mail-di.spec.ts for the incident): a
 * provider the injector cannot resolve aborts the WHOLE application, and
 * unit specs built with `new` never notice. The module is compiled through
 * the real container here.
 */
describe('SyllabusModule DI', () => {
  it('resolves both services through the injector', async () => {
    // CommonAuthModule is @Global() in the real app: the guards' JwtService comes from it.
    const moduleRef = await Test.createTestingModule({ imports: [CommonAuthModule, SyllabusModule] }).compile();
    expect(moduleRef.get(SyllabusService)).toBeInstanceOf(SyllabusService);
    expect(moduleRef.get(SyllabusPortalService)).toBeInstanceOf(SyllabusPortalService);
    await moduleRef.close();
  });
});
