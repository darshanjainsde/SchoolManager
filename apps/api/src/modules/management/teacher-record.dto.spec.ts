import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTeacherDto, UpdateTeacherDto } from './management.dto';
import { teacherRecordData } from './teachers.service';

const base = { firstName: 'Rajeshwari', lastName: 'Balasubramanian' };

describe('the teacher onboarding record', () => {
  it('quick-add is still two names', async () => {
    expect(await validate(plainToInstance(CreateTeacherDto, base))).toEqual([]);
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
