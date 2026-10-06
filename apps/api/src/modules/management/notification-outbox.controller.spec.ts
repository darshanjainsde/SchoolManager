import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { CronSecretGuard } from '../../common/auth/cron-secret.guard';
import { NotificationOutboxController } from './notification-outbox.controller';

describe('NotificationOutboxController', () => {
  it('exposes the drain over GET — Vercel Cron only ever issues a GET', () => {
    const handler = NotificationOutboxController.prototype.runFromCron;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('notification-outbox');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
  });

  it('keeps POST for manual/operator triggering', () => {
    const handler = NotificationOutboxController.prototype.run;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('notification-outbox');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
  });

  it('protects both verbs with CronSecretGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, NotificationOutboxController) ?? [];

    expect(guards).toContain(CronSecretGuard);
  });

  it('drains for either verb', async () => {
    const outbox = { drain: jest.fn().mockResolvedValue({ processed: 3, sent: 2, failed: 1 }) };
    const controller = new NotificationOutboxController(outbox as never);

    await expect(controller.runFromCron()).resolves.toEqual({ processed: 3, sent: 2, failed: 1 });
    await expect(controller.run()).resolves.toEqual({ processed: 3, sent: 2, failed: 1 });
    expect(outbox.drain).toHaveBeenCalledTimes(2);
  });

  it("carries the drain's `more` flag to the caller, so the workflow knows to call again", async () => {
    const outbox = { drain: jest.fn().mockResolvedValueOnce({ processed: 200, sent: 300, more: true }).mockResolvedValueOnce({ processed: 0, sent: 4, more: false }) };
    const controller = new NotificationOutboxController(outbox as never);

    await expect(controller.run()).resolves.toMatchObject({ more: true });
    await expect(controller.run()).resolves.toMatchObject({ more: false });
  });
});
