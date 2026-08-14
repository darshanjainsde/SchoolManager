import { Module } from '@nestjs/common';
import { OutboxCronController } from './outbox.controller';

/**
 * Deliberately carries NO guards. A Vercel cron arrives with no tenant host,
 * no session and no user — the tenancy middleware and the JWT guard would both
 * reject it, and hanging a fake tenant on it to satisfy them would be worse
 * than the bearer-secret check the controller does itself.
 */
@Module({ controllers: [OutboxCronController] })
export class InternalCronModule {}
