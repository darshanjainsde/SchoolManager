import { NotificationService } from './notification.service';
import type { NotificationChannel } from './notification.types';

function fakeChannel(name: string): NotificationChannel {
  return { name, send: jest.fn() };
}

describe('NotificationService', () => {
  it('fans out to every configured channel for every recipient, tallying sent/failed', async () => {
    const email = fakeChannel('email');
    const whatsapp = fakeChannel('whatsapp');
    (email.send as jest.Mock).mockResolvedValue(true);
    (whatsapp.send as jest.Mock).mockResolvedValue(false);

    const svc = new NotificationService([email, whatsapp]);
    const result = await svc.notify('TEST_SCHEDULED', ['a@x.com', 'b@x.com'], { examId: 'e1' });

    expect(result).toEqual({ sent: 2, failed: 2 });
    expect(email.send).toHaveBeenCalledTimes(2);
    expect(email.send).toHaveBeenCalledWith('TEST_SCHEDULED', 'a@x.com', { examId: 'e1' });
    expect(email.send).toHaveBeenCalledWith('TEST_SCHEDULED', 'b@x.com', { examId: 'e1' });
    expect(whatsapp.send).toHaveBeenCalledTimes(2);
  });

  it('does not throw when a channel rejects, and still tallies the other channels correctly', async () => {
    const email = fakeChannel('email');
    const broken = fakeChannel('broken');
    (email.send as jest.Mock).mockResolvedValue(true);
    (broken.send as jest.Mock).mockRejectedValue(new Error('boom'));

    const svc = new NotificationService([email, broken]);

    await expect(
      svc.notify('ABSENCE_NOTICE', ['parent@x.com'], {}),
    ).resolves.toEqual({ sent: 1, failed: 1 });
  });

  it('does not throw when a channel resolves false, tallying it as failed', async () => {
    const email = fakeChannel('email');
    (email.send as jest.Mock).mockResolvedValue(false);

    const svc = new NotificationService([email]);

    await expect(svc.notify('RESULTS_PUBLISHED', ['x@y.com'], {})).resolves.toEqual({
      sent: 0,
      failed: 1,
    });
  });

  it('returns sent:0,failed:0 and calls no channel for an empty recipient list', async () => {
    const email = fakeChannel('email');
    const svc = new NotificationService([email]);

    const result = await svc.notify('TEST_REMINDER', [], { examId: 'e1' });

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(email.send).not.toHaveBeenCalled();
  });
});
