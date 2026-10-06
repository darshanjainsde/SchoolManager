import 'reflect-metadata';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { RolesGuard } from '../../common/auth/roles.guard';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { LeaveDeskGuard } from './internal/leave-desk.guard';
import { SubstitutionController } from './leave.controller';

describe('SubstitutionController — the officer covers what she approves', () => {
  it('admits SCHOOL_ADMIN and STAFF, then narrows STAFF to the leave desk', () => {
    expect(Reflect.getMetadata(ROLES_KEY, SubstitutionController)).toEqual(['SCHOOL_ADMIN', 'STAFF']);
    const guards = Reflect.getMetadata(GUARDS_METADATA, SubstitutionController) as unknown[];
    expect(guards).toContain(LeaveDeskGuard);
    // The desk check runs after login and role: it reads req.user.
    expect(guards.indexOf(LeaveDeskGuard)).toBeGreaterThan(guards.indexOf(RolesGuard));
    expect(guards.indexOf(RolesGuard)).toBeGreaterThan(guards.indexOf(SchoolJwtGuard));
  });

  it('no handler loosens the class rule with roles of its own', () => {
    for (const name of ['candidates', 'assign', 'clear'] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, SubstitutionController.prototype[name])).toBeUndefined();
    }
  });

  it('GET :id/candidates asks the service who is free', async () => {
    const handler = SubstitutionController.prototype.candidates;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':id/candidates');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
    const leave = { candidates: jest.fn().mockResolvedValue([]) };
    const c = new SubstitutionController(leave as never, { requireTenant: () => ({ schoolId: 'S' }) } as never);
    await c.candidates('g1');
    expect(leave.candidates).toHaveBeenCalledWith('S', 'g1');
  });
});
