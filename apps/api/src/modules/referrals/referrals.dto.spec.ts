import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateReferralDto, PayoutDetailsDto, ReferralStageDto, SetPromoterStatusDto, StartCodeDto, UpdatePromoterDto, VerifyCodeDto } from './referrals.dto';

const errorsOf = <T extends object>(cls: new () => T, input: object) => validateSync(plainToInstance(cls, input)).map((e) => e.property);

describe('Refer & Earn DTOs — only the truly required fields are required', () => {
  it('StartCodeDto needs the address for the chosen channel and nothing else', () => {
    expect(errorsOf(StartCodeDto, { channel: 'email', email: ' Priya@Example.com ' })).toEqual([]);
    expect(errorsOf(StartCodeDto, { channel: 'whatsapp', phone: '98765 43210' })).toEqual([]);
    expect(errorsOf(StartCodeDto, { channel: 'email' })).toEqual(['email']);
    expect(errorsOf(StartCodeDto, { channel: 'whatsapp', phone: 'abc' })).toEqual(['phone']);
    expect(errorsOf(StartCodeDto, { channel: 'sms', phone: '9876543210' })).toEqual(['channel']);
    // The email is lower-cased and trimmed on the way in, so one person is one account.
    expect(plainToInstance(StartCodeDto, { channel: 'email', email: ' Priya@Example.com ' }).email).toBe('priya@example.com');
  });

  it('VerifyCodeDto: a six-digit code; name only matters to the service', () => {
    expect(errorsOf(VerifyCodeDto, { challengeId: '3d1c6f1e-4d9a-4a3b-9d8e-5a1b2c3d4e5f', code: ' 482913 ' })).toEqual([]);
    expect(errorsOf(VerifyCodeDto, { challengeId: 'nope', code: '12' }).sort()).toEqual(['challengeId', 'code']);
  });

  it('CreateReferralDto: school, city, contact, phone and consent; everything else optional', () => {
    const ok = { schoolName: 'Green Valley School', city: 'Kota', contactName: 'Mrs Singh', contactPhone: '98555 66778', consent: true };
    expect(errorsOf(CreateReferralDto, ok)).toEqual([]);
    expect(errorsOf(CreateReferralDto, { ...ok, consent: false })).toEqual(['consent']);
    expect(errorsOf(CreateReferralDto, { ...ok, contactPhone: '12' })).toEqual(['contactPhone']);
    expect(errorsOf(CreateReferralDto, { city: 'Kota', contactName: 'Mr Jain', contactPhone: '9855566778', consent: true })).toEqual(['schoolName']);
    expect(errorsOf(CreateReferralDto, { ...ok, studentsApprox: 0 })).toEqual(['studentsApprox']);
    expect(errorsOf(CreateReferralDto, { ...ok, contactEmail: 'not-an-email' })).toEqual(['contactEmail']);
    expect(errorsOf(CreateReferralDto, { ...ok, area: '', board: '', howKnown: '' })).toEqual([]);
  });

  it('UpdatePromoterDto: the questionnaire answers are free text except the ladder key', () => {
    expect(errorsOf(UpdatePromoterDto, { who: 'Teacher', expect: '3-5', areas: 'Kota', know: 'PTA', hasGst: false })).toEqual([]);
    expect(errorsOf(UpdatePromoterDto, { expect: '4-7' })).toEqual(['expect']);
    expect(errorsOf(UpdatePromoterDto, {})).toEqual([]);
  });

  it('PayoutDetailsDto: PAN format, and the bank fields are checked only when given', () => {
    expect(errorsOf(PayoutDetailsDto, { payeeName: 'Rahul Mehta', pan: 'abcpm1234k', upi: 'rahul@okhdfc' })).toEqual([]);
    expect(plainToInstance(PayoutDetailsDto, { payeeName: 'R', pan: 'abcpm1234k' }).pan).toBe('ABCPM1234K');
    expect(errorsOf(PayoutDetailsDto, { payeeName: 'Rahul Mehta', pan: 'ABC1234' })).toEqual(['pan']);
    expect(errorsOf(PayoutDetailsDto, { payeeName: 'Rahul Mehta', pan: 'ABCPM1234K', bankAccount: '12', ifsc: 'HDFC0001234' })).toEqual(['bankAccount']);
    expect(errorsOf(PayoutDetailsDto, { payeeName: 'Rahul Mehta', pan: 'ABCPM1234K', bankAccount: '50100123456789', ifsc: 'hdfc0001234' })).toEqual([]);
  });

  it('ReferralStageDto: the invoice is required only for LIVE; a status outside the owner\'s hand is refused', () => {
    expect(errorsOf(ReferralStageDto, { status: 'CONTACTED' })).toEqual([]);
    expect(errorsOf(ReferralStageDto, { status: 'LIVE' })).toEqual(['invoiceMinor']);
    expect(errorsOf(ReferralStageDto, { status: 'LIVE', invoiceMinor: 124950000 })).toEqual([]);
    expect(errorsOf(ReferralStageDto, { status: 'PAID' })).toEqual(['status']);
  });

  it('SetPromoterStatusDto: a pause or a close needs a reason the promoter can read', () => {
    expect(errorsOf(SetPromoterStatusDto, { status: 'ACTIVE' })).toEqual([]);
    expect(errorsOf(SetPromoterStatusDto, { status: 'SUSPENDED' })).toEqual(['reason']);
    expect(errorsOf(SetPromoterStatusDto, { status: 'SUSPENDED', reason: 'Two referrals without consent.' })).toEqual([]);
  });
});
