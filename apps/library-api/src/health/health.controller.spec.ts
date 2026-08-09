import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('/live never touches a dependency', async () => {
    const controller = new HealthController(
      async () => { throw new Error('db down'); },
      async () => { throw new Error('redis down'); },
    );
    expect(await controller.live()).toEqual({ status: 'ok' });
  });

  it('/ready reports ok when both dependencies answer', async () => {
    const controller = new HealthController(async () => {}, async () => {});
    expect(await controller.ready()).toEqual({ status: 'ok', db: 'ok', redis: 'ok' });
  });

  it('/ready degrades rather than throwing when redis is down', async () => {
    const controller = new HealthController(async () => {}, async () => { throw new Error('x'); });
    expect(await controller.ready()).toEqual({ status: 'degraded', db: 'ok', redis: 'error' });
  });
});
