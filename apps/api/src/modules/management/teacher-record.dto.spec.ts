import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTeacherDto, UpdateTeacherDto } from './management.dto';
import { teacherRecordData } from './teachers.service';

const base = { firstName: 'Rajeshwari', lastName: 'Balasubramanian', email: 'r.bala@school.edu.in', phone: '98765 43210' };

describe('the teacher onboarding record', () => {
  it('quick-add is a first name, an email and a mobile', async () => {
    expect(await validate(plainToInstance(CreateTeacherDto, { firstName: 'Rajeshwari', email: 'r@school.in', phone: '9876543210' }))).toEqual([]);
  });

  it.each([
    ['firstName', { email: 'r@school.in', phone: '9876543210' }, 'Enter their first name.'],
    ['email', { firstName: 'R', phone: '9876543210' }, 'Enter their email. It becomes their login.'],
    ['phone', { firstName: 'R', email: 'r@school.in' }, 'Enter a 10-digit mobile number.'],
  ])('requires %s, and says so in words an office reads', async (field, body, message) => {
    const errors = await validate(plainToInstance(CreateTeacherDto, body));
    const e = errors.find((x) => x.property === field);
    expect(Object.values(e?.constraints ?? {})).toContain(message);
  });

  it.each(['12345', '5876543210', 'not a phone', '+91 98765'])('refuses %p as a mobile', async (phone) => {
    const errors = await validate(plainToInstance(CreateTeacherDto, { ...base, phone }));
    expect(errors.map((e) => e.property)).toEqual(['phone']);
  });

  it.each(['9876543210', '+91 98765 43210', '098765-43210', '919876543210'])('accepts %p as a mobile', async (phone) => {
    expect(await validate(plainToInstance(CreateTeacherDto, { ...base, phone }))).toEqual([]);
  });

  it('lower-cases and trims the email, so one person is one address', () => {
    expect(plainToInstance(CreateTeacherDto, { ...base, email: '  Asha.K@School.IN ' }).email).toBe('asha.k@school.in');
  });

  /**
   * THE REGRESSION (2026-10-07): the Add teacher form sends '' for every field
   * left blank, and twelve of them were refused, which an office read as
   * twelve required fields. This is the form's own body shape.
   */
  it('accepts the form’s real body with every optional field left blank', async () => {
    const blankRecord = Object.fromEntries(
      ['gender', 'dob', 'bloodGroup', 'whatsappPhone', 'employeeCode', 'designation', 'department', 'employmentType', 'joinedOn',
        'highestQualification', 'professionalQualification', 'tetStatus', 'tetCertificateNo', 'tetValidTill', 'specialisation',
        'previousSchool', 'addressLine1', 'addressLine2', 'city', 'region', 'postalCode', 'emergencyContactName',
        'emergencyContactPhone', 'emergencyContactRelation', 'policeVerification', 'policeVerifiedOn', 'medicalFitnessOn', 'pocsoTrainedOn'].map((k) => [k, '']),
    );
    const body = { ...base, lastName: '', photoAssetId: null, whatsappOptIn: false, ...blankRecord };
    expect(await validate(plainToInstance(CreateTeacherDto, body))).toEqual([]);
    expect(await validate(plainToInstance(UpdateTeacherDto, body))).toEqual([]);
    // …and a blank reaches the service as null, which clears the column.
    const dto = plainToInstance(UpdateTeacherDto, body);
    expect(dto.designation).toBeNull();
    expect(dto.dob).toBeNull();
    expect(dto.whatsappPhone).toBeNull();
  });

  it('a blank of only spaces is blank too', async () => {
    expect(plainToInstance(UpdateTeacherDto, { designation: '   ' }).designation).toBeNull();
  });

  it('an edit may leave email and mobile out, but cannot blank them once given', async () => {
    expect(await validate(plainToInstance(UpdateTeacherDto, { designation: 'TGT' }))).toEqual([]);
    const errors = await validate(plainToInstance(UpdateTeacherDto, { email: '', phone: '' }));
    expect(errors.map((e) => e.property).sort()).toEqual(['email', 'phone']);
  });

  it('accepts a full record', async () => {
    const dto = plainToInstance(CreateTeacherDto, {
      ...base,
      gender: 'FEMALE', dob: '1988-03-14', bloodGroup: 'B+',
      whatsappPhone: '98765 43210', whatsappOptIn: true,
      employeeCode: 'RPS-T-042', designation: 'PGT', department: 'Science', employmentType: 'PERMANENT', joinedOn: '2019-06-01',
      highestQualification: 'M.Sc Physics', professionalQualification: 'B.Ed', tetStatus: 'NOT_REQUIRED',
      specialisation: 'Physics', experienceYears: 11, previousSchool: 'DPS Jaipur',
      addressLine1: '12 Vaishali Nagar', city: 'Jaipur', region: 'RJ', postalCode: '302021',
      emergencyContactName: 'S. Balasubramanian', emergencyContactPhone: '9876500000', emergencyContactRelation: 'Spouse',
      policeVerification: 'CLEARED', policeVerifiedOn: '2019-05-20', medicalFitnessOn: '2019-05-22', pocsoTrainedOn: '2025-07-01',
    });
    expect(await validate(dto)).toEqual([]);
  });

  it.each([
    ['designation', 'HEADMASTER'],
    ['employmentType', 'FULLTIME'],
    ['tetStatus', 'YES'],
    ['policeVerification', 'DONE'],
    ['gender', 'F'],
    ['bloodGroup', 'B positive'],
  ])('rejects a %s outside the shared list (%p) — a value the form cannot offer must not arrive from a spreadsheet', async (field, value) => {
    const errors = await validate(plainToInstance(CreateTeacherDto, { ...base, [field]: value }));
    expect(errors.map((e) => e.property)).toContain(field);
  });

  it.each([['dob', '14/03/1988'], ['joinedOn', 'June 2019'], ['tetValidTill', '2030-13-40']])(
    'rejects a %s that is not an ISO date (%p)',
    async (field, value) => {
      const errors = await validate(plainToInstance(CreateTeacherDto, { ...base, [field]: value }));
      expect(errors.map((e) => e.property)).toContain(field);
    },
  );

  it('caps experience at a lifetime and refuses a negative one', async () => {
    for (const experienceYears of [-1, 61, 3.5]) {
      const errors = await validate(plainToInstance(CreateTeacherDto, { ...base, experienceYears }));
      expect(errors.map((e) => e.property)).toContain('experienceYears');
    }
  });

  it('the update DTO carries the same record, all optional', async () => {
    expect(await validate(plainToInstance(UpdateTeacherDto, { designation: 'TGT', whatsappPhone: '' }))).toEqual([]);
    const errors = await validate(plainToInstance(UpdateTeacherDto, { whatsappPhone: '12345' }));
    expect(errors.map((e) => e.property)).toEqual(['whatsappPhone']);
  });
});

describe('teacherRecordData — what the service writes', () => {
  it('turns the record’s ISO date strings into Dates and leaves everything else alone', () => {
    const out = teacherRecordData({ firstName: 'A', dob: '1988-03-14', joinedOn: '2019-06-01', designation: 'PGT' });
    expect(out.dob).toBeInstanceOf(Date);
    expect((out.dob as Date).toISOString().slice(0, 10)).toBe('1988-03-14');
    expect(out.joinedOn).toBeInstanceOf(Date);
    expect(out.designation).toBe('PGT');
    expect(out.firstName).toBe('A');
  });
  it('an emptied date clears the column; an absent one is left untouched', () => {
    const out = teacherRecordData({ dob: '', firstName: 'A' } as Record<string, unknown>);
    expect(out.dob).toBeNull();
    expect('joinedOn' in out).toBe(false);
  });
});
