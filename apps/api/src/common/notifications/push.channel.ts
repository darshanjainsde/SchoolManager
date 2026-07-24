import { Injectable, Logger } from '@nestjs/common';
import { Expo } from 'expo-server-sdk';
import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import type { PrismaClient } from '@skoolos/db';
import { formatNotification } from './format';
import type { NotificationChannel, NotificationMessage } from './notification.types';

/**
 * Delivers a `NotificationMessage` to every registered device for a
 * recipient's email via Expo push.
 *
 * PRISMA CLIENT CHOICE: `NotificationService.notify()` calls
 * `channel.send(recipient.email, message)` with no `schoolId` in scope (see
 * notification.service.ts / notification.types.ts) — recipients.ts's own
 * comment notes both call-site shapes it serves, tenant-scoped and the
 * cross-tenant reminder cron, produce nothing but a bare email string by the
 * time a channel sees it. `EmailChannel` gets away with this because SMTP
 * delivery needs no DB lookup at all; `PushChannel` does need one (device
 * tokens), and with no tenant id available `withTenant(...)` cannot be used
 * — RLS would have nothing to key `app.current_tenant` off, and a
 * `SET LOCAL` with no schoolId narrows every row out, not just the wrong
 * tenant's. `getPlatformPrisma()` (BYPASSRLS, same client `AuthService.login`
 * uses to resolve a `User` before tenant scope exists) is therefore the
 * correct, deliberate choice here, not merely the convenient one — wired up
 * in `notification.module.ts`'s factory, mirroring how every other service
 * in this codebase reaches Prisma via a direct function call rather than
 * Nest constructor DI (there is no injectable `PrismaClient` token). The
 * lookup itself is still narrowed to an exact `email` equality match, so a
 * channel bug can leak at most the rows for that one address — the same
 * blast radius `EmailChannel` already has by design.
 */
@Injectable()
export class PushChannel implements NotificationChannel {
  readonly name = 'push';

  private readonly logger = new Logger(PushChannel.name);
  private readonly expo = new Expo();

  constructor(private readonly prisma: Pick<PrismaClient, 'pushToken'>) {}

  async send(to: string, message: NotificationMessage): Promise<boolean> {
    const rows = await this.prisma.pushToken.findMany({
      where: { email: to },
      select: { token: true },
    });
    const tokens = rows.map((r) => r.token).filter((t) => Expo.isExpoPushToken(t));
    if (tokens.length === 0) return false;

    const { title, body } = formatNotification(message);
    const messages: ExpoPushMessage[] = tokens.map((token) => ({
      to: token,
      sound: 'default',
      title,
      body,
    }));
    const chunks = this.expo.chunkPushNotifications(messages);

    const dead: string[] = [];
    let delivered = false;
    for (const chunk of chunks) {
      let tickets: ExpoPushTicket[];
      try {
        tickets = await this.expo.sendPushNotificationsAsync(chunk);
      } catch (e) {
        this.logger.error(`Expo push chunk failed: ${(e as Error).message}`);
        continue;
      }
      tickets.forEach((ticket, i) => {
        if (ticket.status === 'ok') {
          delivered = true;
        } else if (ticket.details?.error === 'DeviceNotRegistered') {
          dead.push(chunk[i].to as string);
        } else {
          this.logger.warn(`Expo push ticket error for ${to}: ${ticket.message}`);
        }
      });
    }

    if (dead.length > 0) {
      await this.prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
    }

    return delivered;
  }
}
