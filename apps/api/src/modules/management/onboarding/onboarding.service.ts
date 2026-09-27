import { BadRequestException, Injectable } from '@nestjs/common';
import { Workbook, type Worksheet } from 'exceljs';
import { withTenant } from '@skoolos/db';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { COLUMNS, INSTRUCTIONS, headerIndex, type Column, type SheetKind } from './onboarding.sheets';
import { CreateStudentDto, CreateTeacherDto } from '../management.dto';
import { StudentsService } from '../students.service';
import { TeachersService } from '../teachers.service';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';

/**
 * BULK ONBOARDING — the things that take a new school days, done from one
 * spreadsheet each.
 *
 * Three rules that are not negotiable:
 *
 * 1. Every row is checked BEFORE anything is written, and the school sees the
 *    whole report (row, column, what is wrong) first. A half-imported roll is
 *    worse than none: the office cannot tell which 312 of 800 children exist.
 * 2. Rows are created through the SAME services the console uses — student
 *    codes are allocated, phones normalised, admission clashes named — so an
 *    imported child is indistinguishable from a typed one.
 * 3. Import is only ever additive. It never updates or deletes an existing
 *    row; a duplicate admission number or email is an error, not an upsert.
 *
 * The check is deliberately generous with FORMAT (Excel dates, "+91 98765",
 * "Yes"/"Y"/"true") and strict with MEANING (a class that does not exist, a
 * post outside the list, an email already on file).
 */
export interface RowIssue { row: number; column: string; message: string }
export interface ImportPreview {
  kind: SheetKind;
  total: number;
  ok: number;
  issues: RowIssue[];
  /** The first rows as the import will read them, for the school to eyeball. */
  sample: Record<string, unknown>[];
  /** Classes mode: sections that already exist and will be skipped. */
  skipped?: number;
}
export interface ImportResult { created: number; skipped: number; failed: RowIssue[] }
export interface OnboardingImportRow {
  id: string; kind: SheetKind; fileName: string; rows: number; created: number; skipped: number; failed: number; createdAt: string;
}
export interface OnboardingStatus {
  year: { id: string; name: string } | null;
  grades: number; sections: number; teachers: number; students: number;
  imports: OnboardingImportRow[];
}

const MAX_ROWS = 5000;

@Injectable()
export class OnboardingService {
  constructor(private readonly students: StudentsService, private readonly teachers: TeachersService) {}

  // ── templates ────────────────────────────────────────────────────────────

  async template(schoolId: string, kind: SheetKind): Promise<Buffer> {
    const wb = new Workbook();
    wb.creator = 'Sckools';
    // Created first so it is the first tab a school sees; filled at the end.
    const help = wb.addWorksheet('Instructions');
    const data = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols = COLUMNS[kind];
    data.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }));
    data.getRow(1).font = { bold: true };
    data.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEAF8' } };
    // One example row, styled as an example, so the first thing a school sees is what a filled row looks like.
    const example = data.addRow(cols.map((c) => c.example));
    example.font = { italic: true, color: { argb: 'FF6B6B6B' } };
    data.addRow([]);

    const lists = wb.addWorksheet('Lists');
    lists.getRow(1).font = { bold: true };
    let listCol = 1;
    for (const c of cols) {
      let values: readonly string[] | undefined = c.list;
      if (kind === 'students' && (c.key === 'gradeName' || c.key === 'sectionName')) values = await this.classNames(schoolId, c.key === 'gradeName' ? 'grade' : 'section');
      if (!values?.length) continue;
      lists.getCell(1, listCol).value = c.header;
      values.forEach((v, i) => { lists.getCell(i + 2, listCol).value = v; });
      lists.getColumn(listCol).width = Math.max(14, ...values.map((v) => v.length + 2));
      const colLetter = lists.getColumn(listCol).letter;
      const dataCol = data.getColumn(c.key).letter;
      // Dropdowns for the first 5,000 rows, pointing at the Lists sheet.
      for (let r = 2; r <= MAX_ROWS + 1; r += 1) {
        data.getCell(`${dataCol}${r}`).dataValidation = {
          type: 'list', allowBlank: true, formulae: [`Lists!$${colLetter}$2:$${colLetter}$${values.length + 1}`],
          showErrorMessage: true, errorTitle: 'Pick from the list', error: `Choose one of the values on the Lists sheet under "${c.header}".`,
        };
      }
      listCol += 1;
    }
    if (listCol === 1) wb.removeWorksheet(lists.id);

    help.getColumn(1).width = 110;
    help.addRow([`How to fill the ${kind} sheet`]).font = { bold: true, size: 13 };
    for (const line of INSTRUCTIONS[kind]) help.addRow([`• ${line}`]);
    help.addRow([]);
    help.addRow(['Columns']).font = { bold: true };
    for (const c of cols) help.addRow([`${c.header}${c.required ? ' (required)' : ''}${c.list ? ' — pick from the list' : ''}${c.date ? ' — date, YYYY-MM-DD' : ''}`]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private async classNames(schoolId: string, which: 'grade' | 'section'): Promise<string[]> {
    return withTenant(schoolId, async (tx) => {
      if (which === 'grade') {
        const grades = await tx.grade.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId }, orderBy: { order: 'asc' }, select: { name: true } });
        return grades.map((g) => g.name);
      }
      const sections = await tx.classSection.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId }, select: { name: true }, distinct: ['name'], orderBy: { name: 'asc' } });
      return sections.map((c) => c.name);
    });
  }

  // ── exports ──────────────────────────────────────────────────────────────

  async export(schoolId: string, kind: SheetKind): Promise<Buffer> {
    const wb = new Workbook();
    await this.fillExportSheet(wb, 'Data', schoolId, kind);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /**
   * The whole school in one workbook — classes, teachers, students on three
   * sheets, each in its template's layout so any one of them re-imports.
   * The Onboarding header's "Export everything", and the file a school keeps
   * as its own backup.
   */
  async exportAll(schoolId: string): Promise<Buffer> {
    const wb = new Workbook();
    await this.fillExportSheet(wb, 'Classes', schoolId, 'classes');
    await this.fillExportSheet(wb, 'Teachers', schoolId, 'teachers');
    await this.fillExportSheet(wb, 'Students', schoolId, 'students');
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private async fillExportSheet(wb: Workbook, name: string, schoolId: string, kind: SheetKind): Promise<void> {
    const sheet = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols = COLUMNS[kind];
    sheet.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }));
    sheet.getRow(1).font = { bold: true };
    const rows = await withTenant(schoolId, async (tx) => {
      if (kind === 'teachers') return tx.teacher.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
      if (kind === 'students') {
        const list = await tx.student.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId }, orderBy: [{ classSection: { grade: { order: 'asc' } } }, { rollNo: 'asc' }], include: { classSection: { include: { grade: true } } } });
        return list.map((st) => ({ ...st, gradeName: st.classSection?.grade.name ?? '', sectionName: st.classSection?.name ?? '' }));
      }
      const sections = await tx.classSection.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId }, include: { grade: true, classTeacher: { select: { email: true } } }, orderBy: [{ grade: { order: 'asc' } }, { name: 'asc' }] });
      return sections.map((c) => ({ gradeName: c.grade.name, sectionName: c.name, classTeacherEmail: c.classTeacher?.email ?? '' }));
    });
    for (const r of rows as Record<string, unknown>[]) {
      sheet.addRow(cols.map((c) => {
        const v = r[c.key];
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === 'boolean') return v ? 'YES' : 'NO';
        return v ?? '';
      }));
    }
  }

  // ── status: what the school has, and what it imported ────────────────────

  /**
   * The Onboarding home's numbers and its import history. Counts are for the
   * CURRENT session where a thing belongs to one (classes, students); the
   * teacher roll is school-wide.
   */
  async status(schoolId: string): Promise<OnboardingStatus> {
    return withTenant(schoolId, async (tx) => {
      const year = await tx.academicYear.findFirst({ where: { schoolId, isCurrent: true }, select: { id: true, name: true } });
      const [grades, sections, teachers, students, imports] = await Promise.all([
        tx.grade.count({ where: { schoolId } }),
        year ? tx.classSection.count({ where: { schoolId, academicYearId: year.id } }) : Promise.resolve(0),
        tx.teacher.count({ where: { schoolId } }),
        year ? tx.student.count({ where: { schoolId, classSection: { academicYearId: year.id } } }) : Promise.resolve(0),
        tx.onboardingImport.findMany({ where: { schoolId }, orderBy: { createdAt: 'desc' }, take: 10 }),
      ]);
      return {
        year,
        grades, sections, teachers, students,
        imports: imports.map((i) => ({
          id: i.id, kind: i.kind as SheetKind, fileName: i.fileName, rows: i.rows,
          created: i.created, skipped: i.skipped, failed: i.failed, createdAt: i.createdAt.toISOString(),
        })),
      };
    });
  }

  // ── import: parse → check → (confirm) create ─────────────────────────────

  async parse(kind: SheetKind, file: Buffer): Promise<Record<string, unknown>[]> {
    const wb = new Workbook();
    try {
      await wb.xlsx.load(file as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('That file is not an Excel workbook (.xlsx). Download the template and fill that.');
    }
    const sheet: Worksheet | undefined = wb.getWorksheet('Data') ?? wb.worksheets[0];
    if (!sheet) throw new BadRequestException('The workbook has no sheets.');
    const headerRow = sheet.getRow(1);
    const headers: unknown[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, col) => { headers[col - 1] = cell.text; });
    const index = headerIndex(kind, headers);
    const required = COLUMNS[kind].filter((c) => c.required).map((c) => c.key);
    const missing = required.filter((k) => !index.has(k));
    if (missing.length) {
      const names = COLUMNS[kind].filter((c) => missing.includes(c.key)).map((c) => `"${c.header}"`).join(', ');
      throw new BadRequestException(`The header row is missing ${names}. Keep the template's header row as it is.`);
    }
    const cols = COLUMNS[kind];
    const rows: Record<string, unknown>[] = [];
    sheet.eachRow((row, n) => {
      if (n === 1) return;
      const rec: Record<string, unknown> = { __row: n };
      let any = false;
      for (const c of cols) {
        const i = index.get(c.key);
        if (i === undefined) continue;
        const cell = row.getCell(i + 1);
        let v = cellValue(cell.value, c);
        // A list column accepts the office's capitalisation ("yes", "pgt") and
        // stores the list's own spelling, so the check below is about MEANING.
        if (c.list && v) v = c.list.find((x) => x.toLowerCase() === v.toLowerCase()) ?? v;
        if (v !== '' && v !== undefined && v !== null) any = true;
        rec[c.key] = v;
      }
      if (any) rows.push(rec);
    });
    // The template's example row is italic grey and says "Rajeshwari" — a
    // school that forgets to delete it should not get a phantom teacher.
    const example = cols.map((c) => c.example);
    const filtered = rows.filter((r) => !cols.every((c, i) => String(r[c.key] ?? '') === example[i]));
    if (filtered.length > MAX_ROWS) throw new BadRequestException(`That is ${filtered.length} rows; import at most ${MAX_ROWS} at a time.`);
    return filtered;
  }

  async preview(schoolId: string, kind: SheetKind, file: Buffer, opts: { academicYearId?: string }): Promise<ImportPreview & { rows: Record<string, unknown>[] }> {
    const rows = await this.parse(kind, file);
    const issues: RowIssue[] = [];
    const ctx = await this.context(schoolId, kind, opts);
    const seen = new Map<string, Set<string>>();
    const dupCheck = (row: number, column: string, key: string, value: unknown) => {
      const v = String(value ?? '').trim().toLowerCase();
      if (!v) return;
      const set = seen.get(key) ?? new Set<string>();
      if (set.has(v)) issues.push({ row, column, message: `"${value}" appears more than once in this file.` });
      set.add(v); seen.set(key, set);
    };
    const cols = COLUMNS[kind];
    let skipped = 0;
    for (const r of rows) {
      const row = r.__row as number;
      for (const c of cols) {
        const v = r[c.key];
        const label = c.header;
        if (c.required && (v === '' || v === undefined || v === null)) issues.push({ row, column: label, message: `${label} is required.` });
        if (c.list && v !== '' && v !== undefined && v !== null && !c.list.includes(String(v))) {
          issues.push({ row, column: label, message: `"${v}" is not one of: ${c.list.join(', ')}.` });
        }
        if (c.date && v && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) issues.push({ row, column: label, message: `"${v}" is not a date. Use YYYY-MM-DD.` });
      }
      if (kind === 'teachers') {
        dupCheck(row, 'Email', 'email', r.email);
        if (r.email && ctx.teacherEmails.has(String(r.email).toLowerCase())) issues.push({ row, column: 'Email', message: `A teacher with ${r.email} is already on file.` });
        if (r.employeeCode) { dupCheck(row, 'Employee code', 'employeeCode', r.employeeCode); if (ctx.employeeCodes.has(String(r.employeeCode))) issues.push({ row, column: 'Employee code', message: `Employee code ${r.employeeCode} is already on file.` }); }
        const errs = await validate(plainToInstance(CreateTeacherDto, this.teacherBody(r)));
        for (const e of errs) issues.push({ row, column: cols.find((c) => c.key === e.property)?.header ?? e.property, message: Object.values(e.constraints ?? {})[0] ?? 'Invalid value.' });
      }
      if (kind === 'students') {
        dupCheck(row, 'Admission no.', 'admissionNo', r.admissionNo);
        if (r.admissionNo && ctx.admissionNos.has(String(r.admissionNo).trim().toLowerCase())) issues.push({ row, column: 'Admission no.', message: `Admission no. ${r.admissionNo} is already on file.` });
        const g = String(r.gradeName ?? '').trim(); const sec = String(r.sectionName ?? '').trim();
        if ((g && !sec) || (!g && sec)) issues.push({ row, column: 'Class', message: 'Give both Class and Section, or neither.' });
        if (g && sec) {
          const id = ctx.sections.get(sectionKey(g, sec));
          if (!id) issues.push({ row, column: 'Class', message: `No section "${g} — ${sec}" exists in ${ctx.yearName}. Create it first, or check the spelling on the Lists sheet.` });
          else r.classSectionId = id;
        }
        const errs = await validate(plainToInstance(CreateStudentDto, this.studentBody(r)));
        for (const e of errs) issues.push({ row, column: cols.find((c) => c.key === e.property)?.header ?? e.property, message: Object.values(e.constraints ?? {})[0] ?? 'Invalid value.' });
      }
      if (kind === 'classes') {
        const g = String(r.gradeName ?? '').trim(); const sec = String(r.sectionName ?? '').trim();
        dupCheck(row, 'Class', 'section', `${g}|${sec}`);
        if (g && sec && ctx.sections.has(sectionKey(g, sec))) { skipped += 1; r.__skip = true; }
        if (r.classTeacherEmail && !ctx.teacherEmails.has(String(r.classTeacherEmail).toLowerCase())) issues.push({ row, column: 'Class teacher email', message: `No teacher with ${r.classTeacherEmail} is on file.` });
      }
    }
    const bad = new Set(issues.map((i) => i.row));
    return {
      kind, total: rows.length, ok: rows.length - bad.size, issues: issues.sort((a, b) => a.row - b.row), skipped,
      sample: rows.slice(0, 5).map(({ __row, ...rest }) => ({ row: __row, ...rest })),
      rows,
    };
  }

  /** Confirm: only after a clean preview. Re-checks, then creates through the console's own services. */
  async import(schoolId: string, kind: SheetKind, file: Buffer, opts: { academicYearId?: string; fileName?: string }): Promise<ImportResult> {
    const pre = await this.preview(schoolId, kind, file, opts);
    if (pre.issues.length) throw new BadRequestException(`${pre.issues.length} problem(s) remain — fix the file and upload it again. Nothing was imported.`);
    const failed: RowIssue[] = [];
    let created = 0;
    const skipped = pre.skipped ?? 0;
    if (kind === 'teachers') {
      for (const r of pre.rows) {
        try { await this.teachers.create(schoolId, plainToInstance(CreateTeacherDto, this.teacherBody(r))); created += 1; }
        catch (e) { failed.push({ row: r.__row as number, column: '', message: (e as Error).message }); }
      }
    } else if (kind === 'students') {
      for (const r of pre.rows) {
        try { await this.students.create(schoolId, plainToInstance(CreateStudentDto, this.studentBody(r))); created += 1; }
        catch (e) { failed.push({ row: r.__row as number, column: '', message: (e as Error).message }); }
      }
    } else {
      const ctx = await this.context(schoolId, 'classes', opts);
      await withTenant(schoolId, async (tx) => {
        const grades = new Map<string, string>();
        for (const g of await tx.grade.findMany({ where: { schoolId }, select: { id: true, name: true, order: true } })) grades.set(g.name.trim().toLowerCase(), g.id);
        let order = (await tx.grade.count({ where: { schoolId } }));
        for (const r of pre.rows) {
          if (r.__skip) continue;
          const gName = String(r.gradeName).trim(); const sName = String(r.sectionName).trim();
          let gradeId = grades.get(gName.toLowerCase());
          if (!gradeId) { const g = await tx.grade.create({ data: { schoolId, name: gName, order: order++ } }); gradeId = g.id; grades.set(gName.toLowerCase(), g.id); }
          const classTeacherId = r.classTeacherEmail ? ctx.teacherIdByEmail.get(String(r.classTeacherEmail).toLowerCase()) : undefined;
          try {
            await tx.classSection.create({ data: { schoolId, gradeId, name: sName, academicYearId: ctx.yearId, classTeacherId } });
            created += 1;
          } catch (e) { failed.push({ row: r.__row as number, column: '', message: (e as Error).message }); }
        }
      });
    }
    // The log row is written AFTER the rows, outside their transactions: a
    // failed log write must never undo an import, and a school reads this
    // list to answer "did that file go in?" — so it records what happened,
    // including the rows that were refused.
    await this.log(schoolId, {
      kind, fileName: (opts.fileName ?? `${kind}.xlsx`).slice(0, 200),
      rows: pre.rows.length, created, skipped, failed: failed.length,
      academicYearId: opts.academicYearId || null,
    });
    return { created, skipped, failed };
  }

  /** Writes the import log row; never throws — a lost log line must not read as a failed import. */
  private async log(schoolId: string, data: { kind: SheetKind; fileName: string; rows: number; created: number; skipped: number; failed: number; academicYearId: string | null }) {
    try {
      await withTenant(schoolId, (tx) => tx.onboardingImport.create({ data: { schoolId, ...data } }));
    } catch { /* logged nowhere on purpose: the import itself succeeded */ }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async context(schoolId: string, kind: SheetKind, opts: { academicYearId?: string }) {
    return withTenant(schoolId, async (tx) => {
      const year = opts.academicYearId
        ? await tx.academicYear.findFirst({ where: { id: opts.academicYearId, schoolId } })
        : await tx.academicYear.findFirst({ where: { schoolId, isCurrent: true } });
      if ((kind === 'students' || kind === 'classes') && !year) throw new BadRequestException('Pick the session these rows belong to.');
      const sections = new Map<string, string>();
      if (year) {
        for (const c of await tx.classSection.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, academicYearId: year.id }, include: { grade: { select: { name: true } } } })) {
          sections.set(sectionKey(c.grade.name, c.name), c.id);
        }
      }
      const teachers = await tx.teacher.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId }, select: { id: true, email: true, employeeCode: true } });
      const students = kind === 'students' ? await tx.student.findMany({ take: LIST_CEILING.ROSTER, where: { schoolId }, select: { admissionNo: true } }) : [];
      return {
        yearId: year?.id ?? '', yearName: year?.name ?? '',
        sections,
        teacherEmails: new Set(teachers.map((t) => t.email?.toLowerCase()).filter((e): e is string => !!e)),
        teacherIdByEmail: new Map(teachers.filter((t) => t.email).map((t) => [t.email!.toLowerCase(), t.id])),
        employeeCodes: new Set(teachers.map((t) => t.employeeCode).filter((c): c is string => !!c)),
        admissionNos: new Set(students.map((s) => s.admissionNo.trim().toLowerCase())),
      };
    });
  }

  private teacherBody(r: Record<string, unknown>) {
    const b: Record<string, unknown> = {};
    for (const c of COLUMNS.teachers) {
      const v = r[c.key];
      if (v === '' || v === undefined || v === null) continue;
      if (c.key === 'whatsappOptIn') b[c.key] = yes(v);
      else if (c.key === 'experienceYears') b[c.key] = Number(v);
      else b[c.key] = String(v);
    }
    return b;
  }
  private studentBody(r: Record<string, unknown>) {
    const b: Record<string, unknown> = {};
    for (const c of COLUMNS.students) {
      if (c.key === 'gradeName' || c.key === 'sectionName') continue;
      const v = r[c.key];
      if (v === '' || v === undefined || v === null) continue;
      b[c.key] = String(v);
    }
    if (r.classSectionId) b.classSectionId = r.classSectionId;
    return b;
  }
}

const sectionKey = (grade: string, section: string) => `${grade.trim().toLowerCase()}|${section.trim().toLowerCase()}`;
const yes = (v: unknown) => /^(y|yes|true|1)$/i.test(String(v).trim());

/** A cell as the import reads it: dates → YYYY-MM-DD, numbers → text, formulas → their result, everything trimmed. */
export function cellValue(v: unknown, c: Column): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (o.richText) return o.richText.map((t) => t.text).join('').trim();
    if ('result' in o) return cellValue(o.result, c);
    if (typeof o.text === 'string') return o.text.trim();
    return '';
  }
  if (typeof v === 'number') {
    // An Excel date typed as a serial in a date column.
    if (c.date && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
    return Number.isInteger(v) ? String(v) : String(v);
  }
  const s = String(v).trim();
  if (c.date) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); // 14/03/1988 — the way an Indian office writes it
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return s;
}
