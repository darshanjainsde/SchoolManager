import 'reflect-metadata';
import { EnquiryAdminController } from './enquiry-admin.controller';
import { AdmissionsDeskGuard } from './internal/admissions-desk.guard';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { ROLES_KEY } from '../../common/auth/roles.decorator';

/**
 * /site/enquiries hands back families' names and phone numbers. It used to be
 * SCHOOL_ADMIN-only; now an admissions officer — a STAFF login — works it too.
 * Written against guard metadata (the ops.authz.spec pattern) so it runs in the
 * unit job; admissions-desk.e2e-spec.ts proves the same against a database.
 */
describe('/site/enquiries authorization', () => {
  const guards = Reflect.getMetadata('__guards__', EnquiryAdminController) ?? [];

  it('runs the school token, the role list and the desk guard, in that order', () => {
    expect(guards).toEqual([SchoolJwtGuard, RolesGuard, AdmissionsDeskGuard]);
  });

  it('lets SCHOOL_ADMIN and STAFF reach the desk guard, which narrows STAFF to the job', () => {
    expect(Reflect.getMetadata(ROLES_KEY, EnquiryAdminController)).toEqual(['SCHOOL_ADMIN', 'STAFF']);
  });

  it('no handler replaces the class role list', () => {
    const proto = EnquiryAdminController.prototype as unknown as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || typeof proto[name] !== 'function') continue;
      expect({ name, roles: Reflect.getMetadata(ROLES_KEY, proto[name] as object) }).toEqual({ name, roles: undefined });
    }
  });

  it('declares /owners before /:id, so "owners" never reaches ParseUUIDPipe', () => {
    const order = Object.getOwnPropertyNames(EnquiryAdminController.prototype);
    expect(order.indexOf('owners')).toBeGreaterThan(-1);
    expect(order.indexOf('owners')).toBeLessThan(order.indexOf('detail'));
  });
});
