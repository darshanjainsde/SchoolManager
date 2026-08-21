import type { PrismaClient } from '@skoolos/db';
import type { NotificationChannel, NotificationMessage } from './notification.types';
/**
 * Delivers a `NotificationMessage` to every registered device for a
 * recipient's email + school via Expo push.
 *
 * PRISMA CLIENT CHOICE: `EmailChannel` needs no DB lookup at all (SMTP
 * delivery is handed a resolved address directly). `PushChannel` does need
 * one (device tokens), and `withTenant(...)` is unavailable here — this
 * channel runs well after the caller's own tenant transaction has committed,
 * with no live RLS session to piggyback on. `getPlatformPrisma()` (BYPASSRLS,
 * same client `AuthService.login` uses to resolve a `User` before tenant
 * scope exists) is therefore the correct, deliberate choice here — wired up
 * in `notification.module.ts`'s factory, mirroring how every other service
 * in this codebase reaches Prisma via a direct function call rather than
 * Nest constructor DI (there is no injectable `PrismaClient` token).
 *
 * SCHOOL SCOPING IS LOAD-BEARING: because this lookup bypasses RLS, it MUST
 * filter by `schoolId` in addition to `email`. `User.email` is only unique
 * `@@unique([schoolId, email])` (packages/db/prisma/schema.prisma) — NOT
 * globally unique. Two different people at two different schools can share
 * an email string (plausible with generic addresses, and common across
 * seeded demo/QA tenants). Filtering by `email` alone would deliver School
 * A's push — an ABSENCE_NOTICE naming a specific child, or an ANNOUNCEMENT
 * body — to School B's devices for that address too. `NotificationService`
 * passes `schoolId` from the recipient it already resolved inside the
 * caller's `withTenant(schoolId, ...)` block (see recipients.ts /
 * notification.types.ts), so it is always available by the time a channel
 * sees it — this was a real cross-tenant PII leak until this filter was
 * added.
 */
export declare class PushChannel implements NotificationChannel {
    private readonly prisma;
    readonly name = "push";
    private readonly logger;
    constructor(prisma: Pick<PrismaClient, 'pushToken'>);
    send(to: string, message: NotificationMessage, schoolId: string): Promise<boolean>;
}
//# sourceMappingURL=push.channel.d.ts.map