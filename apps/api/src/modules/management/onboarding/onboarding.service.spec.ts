import 'reflect-metadata';
import { Workbook } from 'exceljs';
import { BadRequestException } from '@nestjs/common';

const txMock = {
  academicYear: { findFirst: jest.fn() },
  classSection: { findMany: jest.fn(), create: jest.fn() },
  teacher: { findMany: jest.fn() },
  student: { findMany: jest.fn() },
  grade: { findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
  onboardingImport: { create: jest.fn(), findMany: jest.fn() },
  teacherCount: undefined,
};
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { OnboardingService, cellValue } from './onboarding.service';
import { TEACHER_COLUMNS, STUDENT_COLUMNS, CLASS_COLUMNS, headerIndex } from './onboarding.sheets';
import type { StudentsService } from '../students.service';
import type { TeachersService } from '../teachers.service';

const SCHOOL = 'school-1';
const students = { create: jest.fn() };
const teachers = { create: jest.fn() };
const svc = new OnboardingService(students as unknown as StudentsService, teachers as unknown as TeachersService);

/** Build a workbook the way a school office would: a header row, then rows. */
async function xlsx(headers: string[], rows: unknown[][], sheetName = 'Data'): Promise<Buffer> {
  const wb = new Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const H = (cols: { header: string }[]) => cols.map((c) => c.header);

beforeEach(() => {
  jest.clearAllMocks();
  txMock.academicYear.findFirst.mockResolvedValue({ id: 'y1', name: '2026-27' });
  txMock.classSection.findMany.mockResolvedValue([{ id: '11111111-1111-4111-8111-111111111111', name: 'B', grade: { name: '5' } }]);
  txMock.teacher.findMany.mockResolvedValue([{ id: 't1', email: 'existing@school.test', employeeCode: 'T-001' }]);
  txMock.student.findMany.mockResolvedValue([{ admissionNo: 'ADM-001' }]);
  txMock.grade.findMany.mockResolvedValue([{ id: 'g5', name: '5', order: 0 }]);
  txMock.grade.count.mockResolvedValue(1);
  students.create.mockResolvedValue({ id: 's-new' });
  teachers.create.mockResolvedValue({ id: 't-new' });
});

describe('reading the workbook', () => {
  it('matches headers by name, forgiving case, spaces and punctuation, and finds the required ones', () => {
    const idx = headerIndex('students', ['ADMISSION NO', 'first  name', 'Last-Name', 'Class', 'section']);
    expect(idx.get('admissionNo')).toBe(0);
    expect(idx.get('firstName')).toBe(1);
    expect(idx.get('lastName')).toBe(2);
    expect(idx.get('sectionName')).toBe(4);
  });
  it('refuses a file whose header row lost a required column, and names it', async () => {
    const file = await xlsx(['First name', 'Last name'], [['A', 'B']]);
    await expect(svc.parse('students', file)).rejects.toThrow(/missing "Admission no\."/);
  });
  it('refuses something that is not a workbook', async () => {
    await expect(svc.parse('teachers', Buffer.from('name,email\nA,B'))).rejects.toThrow(/not an Excel workbook/);
  });
  it('drops the template’s own example row, so a forgotten example never becomes a teacher', async () => {
    const example = TEACHER_COLUMNS.map((c) => c.example);
    const file = await xlsx(H(TEACHER_COLUMNS), [example, ['Priya', 'Iyer']]);
    const rows = await svc.parse('teachers', file);
    expect(rows.map((r) => r.firstName)).toEqual(['Priya']);
  });
  it('reads the Data sheet by name when there are several', async () => {
    const wb = new Workbook();
    wb.addWorksheet('Instructions').addRow(['ignore me']);
    const ws = wb.addWorksheet('Data'); ws.addRow(H(CLASS_COLUMNS)); ws.addRow(['Nursery', 'A']);
    const rows = await svc.parse('classes', Buffer.from(await wb.xlsx.writeBuffer()));
    expect(rows).toHaveLength(1);
  });
});

describe('cellValue — what an office actually types', () => {
  const dateCol = { header: 'x', key: 'x', date: true, example: '' };
  const textCol = { header: 'x', key: 'x', example: '' };
  it('an Excel date cell becomes YYYY-MM-DD', () => expect(cellValue(new Date(Date.UTC(1988, 2, 14)), dateCol)).toBe('1988-03-14'));
  it('an Indian-style 14/03/1988 becomes 1988-03-14', () => expect(cellValue('14/03/1988', dateCol)).toBe('1988-03-14'));
  it('an Excel serial in a date column becomes a date', () => expect(cellValue(32216, dateCol)).toBe('1988-03-14'));
  it('a formula cell yields its result', () => expect(cellValue({ formula: 'A1', result: 'Aarav' }, textCol)).toBe('Aarav'));
  it('rich text is flattened', () => expect(cellValue({ richText: [{ text: 'Aa' }, { text: 'rav' }] }, textCol)).toBe('Aarav'));
  it('a phone typed as a number keeps its digits', () => expect(cellValue(9876543210, textCol)).toBe('9876543210'));
  it('blanks are blanks', () => { expect(cellValue(null, textCol)).toBe(''); expect(cellValue('  ', textCol)).toBe(''); });
});

describe('the preview — every problem, before anything is written', () => {
  it('a clean teacher file previews clean and shows a sample', async () => {
    const file = await xlsx(H(TEACHER_COLUMNS), [['Rajeshwari', 'Balasubramanian', 'r.b@school.test', '9876543210', '', 'YES', 'FEMALE', '1988-03-14', 'B+', 'T-042', 'PGT']]);
    const pre = await svc.preview(SCHOOL, 'teachers', file, {});
    expect(pre.issues).toEqual([]);
    expect(pre.ok).toBe(1);
    expect(pre.sample[0]).toMatchObject({ row: 2, firstName: 'Rajeshwari', designation: 'PGT', whatsappOptIn: 'YES' });
  });
  it('names the row and column for a missing name, a post outside the list, a bad date and a duplicate email', async () => {
    const file = await xlsx(H(TEACHER_COLUMNS), [
      ['', 'Nameless', 'a@school.test', '', '', '', '', '', '', '', 'HEADMASTER'],
      ['Priya', 'Iyer', 'a@school.test', '', '', '', '', 'March 1988'],
    ]);
    const pre = await svc.preview(SCHOOL, 'teachers', file, {});
    const msgs = pre.issues.map((i) => `${i.row}·${i.column}: ${i.message}`);
    expect(msgs).toEqual(expect.arrayContaining([
      expect.stringMatching(/^2·First name: First name is required/),
      expect.stringMatching(/^2·Post: "HEADMASTER" is not one of/),
      expect.stringMatching(/^3·Date of birth: "March 1988" is not a date/),
      expect.stringMatching(/^3·Email: "a@school.test" appears more than once/),
    ]));
    expect(pre.ok).toBe(0);
  });
  it('an email or employee code already on file is an error, never an update', async () => {
    const file = await xlsx(H(TEACHER_COLUMNS), [['Priya', 'Iyer', 'Existing@School.test', '', '', '', '', '', '', 'T-001']]);
    const pre = await svc.preview(SCHOOL, 'teachers', file, {});
    expect(pre.issues.map((i) => i.column).sort()).toEqual(['Email', 'Employee code']);
  });
  it('students: resolves Class + Section to the session’s section, and refuses one that does not exist', async () => {
    const file = await xlsx(H(STUDENT_COLUMNS), [
      ['ADM-101', 'Aarav', 'Mehta', '5', 'B'],
      ['ADM-102', 'Meera', 'Shah', '6', 'A'],
      ['ADM-103', 'Kabir', 'Bhat', '5', ''],
      ['ADM-001', 'Dup', 'Licate', '', ''],
    ]);
    const pre = await svc.preview(SCHOOL, 'students', file, { academicYearId: 'y1' });
    const by = (row: number) => pre.issues.filter((i) => i.row === row).map((i) => i.message);
    expect(by(2)).toEqual([]);
    expect(by(3)[0]).toMatch(/No section "6 — A" exists in 2026-27/);
    expect(by(4)[0]).toMatch(/both Class and Section, or neither/);
    expect(by(5)[0]).toMatch(/ADM-001 is already on file/);
    expect(pre.rows[0].classSectionId).toBe('11111111-1111-4111-8111-111111111111');
    expect(pre.ok).toBe(1);
  });
  it('students: without a session there is nothing to import into', async () => {
    txMock.academicYear.findFirst.mockResolvedValue(null);
    const file = await xlsx(H(STUDENT_COLUMNS), [['ADM-101', 'Aarav', 'Mehta']]);
    await expect(svc.preview(SCHOOL, 'students', file, {})).rejects.toThrow(/Pick the session/);
  });
  it('classes: a section that already exists is counted as skipped, not flagged', async () => {
    const file = await xlsx(H(CLASS_COLUMNS), [['5', 'B'], ['5', 'C'], ['Nursery', 'A', 'nobody@school.test']]);
    const pre = await svc.preview(SCHOOL, 'classes', file, { academicYearId: 'y1' });
    expect(pre.skipped).toBe(1);
    expect(pre.issues).toEqual([{ row: 4, column: 'Class teacher email', message: 'No teacher with nobody@school.test is on file.' }]);
  });
});

describe('the import', () => {
  it('refuses while any problem remains, and writes nothing', async () => {
    const file = await xlsx(H(TEACHER_COLUMNS), [['', 'Nameless']]);
    await expect(svc.import(SCHOOL, 'teachers', file, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(teachers.create).not.toHaveBeenCalled();
  });
  it('creates teachers through the console’s own service, with the record typed the way the DTO expects', async () => {
    const file = await xlsx(H(TEACHER_COLUMNS), [['Rajeshwari', 'Balasubramanian', 'r.b@school.test', '9876543210', '9876543210', 'yes', 'FEMALE', '1988-03-14', '', '', 'PGT', 'Science', 'PERMANENT', '2019-06-01', '', '', '', '', '', '', '11']]);
    const res = await svc.import(SCHOOL, 'teachers', file, { fileName: 'teachers-sept.xlsx' });
    expect(res).toEqual({ created: 1, skipped: 0, failed: [] });
    // The log row says what went in — and the file it came from.
    expect(txMock.onboardingImport.create).toHaveBeenCalledWith({ data: expect.objectContaining({ schoolId: SCHOOL, kind: 'teachers', fileName: 'teachers-sept.xlsx', rows: 1, created: 1, failed: 0 }) });
    expect(teachers.create).toHaveBeenCalledWith(SCHOOL, expect.objectContaining({
      firstName: 'Rajeshwari', whatsappOptIn: true, designation: 'PGT', experienceYears: 11, joinedOn: '2019-06-01',
    }));
  });
  it('creates students with the resolved section id and never the class names', async () => {
    const file = await xlsx(H(STUDENT_COLUMNS), [['ADM-101', 'Aarav', 'Mehta', '5', 'B', '12', 'MALE', '2016-08-21', 'Priya Mehta', '9876543210']]);
    const res = await svc.import(SCHOOL, 'students', file, { academicYearId: 'y1' });
    expect(res.created).toBe(1);
    const dto = students.create.mock.calls[0][1];
    expect(dto).toMatchObject({ admissionNo: 'ADM-101', classSectionId: '11111111-1111-4111-8111-111111111111', rollNo: '12', guardianPhone: '9876543210' });
    expect(dto).not.toHaveProperty('gradeName');
  });
  it('reports a row the service refused, and keeps going', async () => {
    students.create.mockRejectedValueOnce(new Error('That admission number is already taken by Aarav Mehta'));
    const file = await xlsx(H(STUDENT_COLUMNS), [['ADM-101', 'A', 'B'], ['ADM-102', 'C', 'D']]);
    const res = await svc.import(SCHOOL, 'students', file, { academicYearId: 'y1' });
    expect(res.created).toBe(1);
    expect(res.failed).toEqual([{ row: 2, column: '', message: 'That admission number is already taken by Aarav Mehta' }]);
  });
  it('classes: creates a missing grade once, skips existing sections, links the class teacher', async () => {
    txMock.classSection.create.mockResolvedValue({});
    txMock.grade.create.mockResolvedValue({ id: 'g-nursery' });
    const file = await xlsx(H(CLASS_COLUMNS), [['5', 'B'], ['Nursery', 'A', 'existing@school.test'], ['Nursery', 'B']]);
    const res = await svc.import(SCHOOL, 'classes', file, { academicYearId: 'y1' });
    expect(res).toEqual({ created: 2, skipped: 1, failed: [] });
    expect(txMock.grade.create).toHaveBeenCalledTimes(1);
    expect(txMock.classSection.create.mock.calls[0][0].data).toMatchObject({ gradeId: 'g-nursery', name: 'A', academicYearId: 'y1', classTeacherId: 't1' });
  });
});

describe('the templates and exports', () => {
  it('a template has Instructions, Data with the header row, and dropdown lists', async () => {
    txMock.grade.findMany.mockResolvedValue([{ name: 'Nursery' }, { name: '5' }]);
    txMock.classSection.findMany.mockResolvedValue([{ name: 'A' }, { name: 'B' }]);
    const buf = await svc.template(SCHOOL, 'students');
    const wb = new Workbook(); await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Instructions', 'Data', 'Lists']);
    const data = wb.getWorksheet('Data')!;
    expect(data.getRow(1).values).toEqual(expect.arrayContaining(STUDENT_COLUMNS.map((c) => c.header)));
    expect(data.getCell('D3').dataValidation?.type).toBe('list'); // Class → Lists sheet
    const lists = wb.getWorksheet('Lists')!;
    expect(String(lists.getCell(1, 1).value)).toBe('Class');
    expect(lists.getCell(2, 1).value).toBe('Nursery');
  });
  it('an export round-trips through the parser', async () => {
    txMock.teacher.findMany.mockResolvedValue([{ firstName: 'Priya', lastName: 'Iyer', email: 'p@school.test', whatsappOptIn: true, dob: new Date(Date.UTC(1990, 0, 2)), designation: 'TGT' }]);
    const buf = await svc.export(SCHOOL, 'teachers');
    const rows = await svc.parse('teachers', buf);
    expect(rows[0]).toMatchObject({ firstName: 'Priya', email: 'p@school.test', whatsappOptIn: 'YES', dob: '1990-01-02', designation: 'TGT' });
  });
});
