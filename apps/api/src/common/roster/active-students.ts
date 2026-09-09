import type { Prisma } from '@skoolos/db';

/**
 * The three "no longer here" states. ACTIVE is the only enrolled state — see
 * `enum StudentStatus` in schema.prisma.
 */
export const LEFT_STATUSES = ['ALUMNI', 'TRANSFERRED', 'LEFT'] as const;

/**
 * The ONE way to ask for the students who are actually in the school.
 *
 * Before the Active Roster work, `Student.isActive` existed but nothing set it
 * and only the Library read it, so a child who had left kept a seat on every
 * register, diary page and push list. Every roster and recipient query now goes
 * through here, and `roster-filter.spec.ts` reads the source to make sure the
 * next one does too.
 *
 * `schoolId` is spelled out even inside `withTenant` (RLS is the backstop, the
 * explicit scope is the intent — the same rule every service here follows).
 */
export function activeStudentsWhere(
  schoolId: string,
  extra: Prisma.StudentWhereInput = {},
): Prisma.StudentWhereInput {
  return { schoolId, status: 'ACTIVE', ...extra };
}
