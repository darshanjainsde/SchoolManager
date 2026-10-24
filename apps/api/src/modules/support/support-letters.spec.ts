import { ownerAlertLetter, schoolUpdateText } from './support-letters';

const facts = {
  ticketNo: 'SK-000142', title: 'Receipt PDF fails for one student', schoolName: 'Raffles Public School',
  severityLabel: 'Blocking us today', moduleLabel: 'Fees', typeLabel: 'Something broke', by: 'Priya Nair',
  preview: 'Pressing Print receipt shows "Something went wrong".', url: 'https://owner.sckools.com/platform/support/abc',
};

describe('the owner alert', () => {
  it('names the ticket and the school in the subject, and says what happened', () => {
    const raised = ownerAlertLetter('RAISED', facts);
    expect(raised.subject).toBe('SK-000142 · Raffles Public School raised: Receipt PDF fails for one student');
    expect(raised.letter.intro).toContain('Priya Nair at Raffles Public School raised a ticket');
    expect(ownerAlertLetter('REPLIED', facts).subject).toContain('replied on');
    expect(ownerAlertLetter('REOPENED', facts).letter.intro).toContain('reopened SK-000142');
  });

  it('carries severity and module as rows, the words as a quote, and a link to the desk', () => {
    const { letter } = ownerAlertLetter('RAISED', facts);
    expect(letter.rows).toEqual(expect.arrayContaining([
      { label: 'Severity', value: 'Blocking us today' },
      { label: 'Module', value: 'Fees' },
    ]));
    expect(letter.quote).toBe(facts.preview);
    expect(letter.cta).toEqual({ label: 'Open the ticket', url: facts.url });
  });

  it('is an alert only when the school is blocked', () => {
    expect(ownerAlertLetter('RAISED', facts).letter.tone).toBe('alert');
    expect(ownerAlertLetter('RAISED', { ...facts, severityLabel: 'Annoying' }).letter.tone).toBe('default');
  });
});

describe('what the school admin reads', () => {
  it('leads with the move and keeps the ticket number in the body', () => {
    expect(schoolUpdateText('RESOLVED', facts)).toEqual({
      title: 'Sckools marked your ticket resolved',
      body: 'SK-000142 · Receipt PDF fails for one student · tell us if it is fixed, or reopen it',
    });
    expect(schoolUpdateText('ACKNOWLEDGED', facts).title).toBe('Sckools picked up your ticket');
    expect(schoolUpdateText('STATUS', { ...facts, statusLabel: 'Waiting on you' }).title).toBe('Your ticket is now Waiting on you');
    expect(schoolUpdateText('OPENED', facts).body).toMatch(/^SK-000142/);
  });
});
