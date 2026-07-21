import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { CronSecretGuard } from './cron-secret.guard';
import { ExamRemindersController } from './exam-reminders.controller';

describe('ExamRemindersController', () => {
  it('exposes the reminder run over GET — Vercel Cron only ever issues a GET', () => {
    const handler = ExamRemindersController.prototype.runFromCron;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('exam-reminders');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
  });

  it('keeps POST for manual/operator triggering', () => {
    const handler = ExamRemindersController.prototype.run;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('exam-reminders');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
  });

  it('protects both verbs with CronSecretGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ExamRemindersController) ?? [];

    expect(guards).toContain(CronSecretGuard);
  });

  it('runs the service for either verb', async () => {
    const reminders = { run: jest.fn().mockResolvedValue({ exams: 3, sent: 7 }) };
    const controller = new ExamRemindersController(reminders as never);

    await expect(controller.runFromCron()).resolves.toEqual({ exams: 3, sent: 7 });
    await expect(controller.run()).resolves.toEqual({ exams: 3, sent: 7 });
    expect(reminders.run).toHaveBeenCalledTimes(2);
  });
});
