import {
  NOTIFICATION_KINDS, NOTIFICATION_OUTBOX_KINDS, SUPPORT_MODULES, SUPPORT_MODULE_LABEL, SUPPORT_SEVERITIES,
  SUPPORT_SEVERITY_LABEL, SUPPORT_STATUSES, SUPPORT_STATUS_LABEL, SUPPORT_STATUS_LABEL_SCHOOL, SUPPORT_STATUS_TONE,
  SUPPORT_TICKET_TYPES, SUPPORT_TICKET_TYPE_LABEL, supportTicketNo,
} from './index';

describe('the support desk contracts', () => {
  it('formats the ticket number with six digits, and never truncates a bigger one', () => {
    expect(supportTicketNo(142)).toBe('SK-000142');
    expect(supportTicketNo(1)).toBe('SK-000001');
    expect(supportTicketNo(1234567)).toBe('SK-1234567');
  });

  it('every status has a label on both sides of the desk and a tone the pill can paint', () => {
    for (const s of SUPPORT_STATUSES) {
      expect(SUPPORT_STATUS_LABEL[s]).toBeTruthy();
      expect(SUPPORT_STATUS_LABEL_SCHOOL[s]).toBeTruthy();
      expect(['info', 'warn', 'good', 'neutral']).toContain(SUPPORT_STATUS_TONE[s]);
    }
    // The one state whose next move is the school's reads differently on each side.
    expect(SUPPORT_STATUS_LABEL.WAITING_ON_SCHOOL).toBe('Waiting on school');
    expect(SUPPORT_STATUS_LABEL_SCHOOL.WAITING_ON_SCHOOL).toBe('Waiting on you');
    expect(SUPPORT_STATUS_TONE.WAITING_ON_SCHOOL).toBe('warn');
  });

  it('every module, type and severity has plain words', () => {
    for (const m of SUPPORT_MODULES) expect(SUPPORT_MODULE_LABEL[m]).toBeTruthy();
    for (const t of SUPPORT_TICKET_TYPES) expect(SUPPORT_TICKET_TYPE_LABEL[t]).toBeTruthy();
    for (const s of SUPPORT_SEVERITIES) expect(SUPPORT_SEVERITY_LABEL[s]).toBeTruthy();
  });

  it('the desk has its notification kinds', () => {
    expect(NOTIFICATION_KINDS).toContain('SUPPORT');
    expect(NOTIFICATION_OUTBOX_KINDS).toContain('SUPPORT_UPDATE');
  });
});
