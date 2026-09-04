import { SetMetadata } from '@nestjs/common';
import type { StaffRole } from '@skoolos/db';

export const STAFF_ROLES = 'staffRoles';

/**
 * Which KINDS of staff may reach this controller.
 *
 * `@Roles('STAFF')` is too coarse for anything that matters: the enum covers
 * OFFICE, SUPPORT, DRIVER, HELPER, SECURITY and LIBRARIAN, and a role check
 * that names STAFF admits the driver alongside the bursar. Pair this with
 * `StaffScopeGuard` to narrow it, the way LibrarianGuard already does for the
 * library counter.
 */
export const StaffRoles = (...roles: StaffRole[]) => SetMetadata(STAFF_ROLES, roles);
