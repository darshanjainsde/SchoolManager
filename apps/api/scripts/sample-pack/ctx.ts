import { getPlatformPrisma } from '@skoolos/db';
import type { Rng } from './rng';

export type Db = ReturnType<typeof getPlatformPrisma>;

export interface TeacherInfo {
  id: string; userId: string; email: string; name: string; subjects: string[];
  grossRupees: number; joined: string; designation: string;
}
export interface StaffInfo {
  id: string; userId: string; email: string; name: string; role: string; grossRupees: number;
}
export interface SectionInfo {
  id: string; gradeIdx: number; grade: string; letter: string; label: string;
  classTeacher: TeacherInfo; subjects: string[];
}
export interface StudentInfo {
  id: string; userId: string; code: string; name: string; first: string; last: string;
  sectionId: string; gradeIdx: number; guardian: string; phone: string;
  /** Chance of being absent on an ordinary day — drives attendance AND, a little, marks. */
  absentRate: number;
  ability: number;
  onBus: boolean; isRte: boolean;
}

export interface Ctx {
  p: Db;
  r: Rng;
  schoolId: string;
  yearId: string;
  pwHash: string;
  subjectId: Map<string, string>;
  subjectName: Map<string, string>;
  gradeId: string[];
  houseIds: string[];
  teachers: TeacherInfo[];
  staff: StaffInfo[];
  sections: SectionInfo[];
  students: StudentInfo[];
  /** The office login stands in for "the school" wherever a row needs an actor. */
  officeUserId: string;
  accountsUserId: string;
  librarianUserId: string;
  holidays: Set<string>;
  /** Teaching days inside the attendance window. */
  schoolDays: string[];
  /** personId → ISO dates of approved leave. */
  leaveDays: Map<string, Set<string>>;
  /** teacher for (sectionId|subjectCode) */
  teacherFor: Map<string, TeacherInfo>;
  /** Half-yearly percentage per student, for the report-card remark. */
  halfYearly: Map<string, number>;
  counts: Record<string, number>;
}

/** Bulk insert in sensible slices; returns how many rows went in. */
export async function many<T>(
  c: Ctx, label: string, rows: T[], write: (batch: T[]) => Promise<unknown>, size = 2000,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
  c.counts[label] = (c.counts[label] ?? 0) + rows.length;
}
