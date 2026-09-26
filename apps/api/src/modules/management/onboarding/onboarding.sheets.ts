/**
 * THE ONBOARDING WORKBOOKS — what a school downloads, fills and sends back.
 *
 * One workbook per kind. Each has a `Data` sheet with a header row the import
 * reads BY NAME (so a school may reorder or hide columns), an `Instructions`
 * sheet in plain words, and where it helps a `Lists` sheet the dropdowns
 * point at, so a designation or a class is picked, not typed. Nothing here is
 * clever: a school office fills these in Excel on a Windows laptop.
 *
 * Column definitions are the single source for the template, the parser and
 * the export, so the three cannot drift.
 */
import { EMPLOYMENT_TYPES, GENDERS, POLICE_VERIFICATION, PROFESSIONAL_QUALIFICATIONS, TEACHER_DESIGNATIONS, TET_STATUSES, BLOOD_GROUPS, STUDENT_CATEGORIES } from '@skoolos/types';

export type SheetKind = 'teachers' | 'students' | 'classes';

export interface Column {
  /** The header text a school sees. Matched case- and space-insensitively on import. */
  header: string;
  /** The DTO / model field it maps to. */
  key: string;
  required?: boolean;
  /** Excel data-validation list; also printed on the Lists sheet. */
  list?: readonly string[];
  /** An ISO date column: shown as a date in Excel, parsed back to YYYY-MM-DD. */
  date?: boolean;
  example: string;
  width?: number;
}

const codes = (l: readonly (readonly [string, string])[]) => l.map(([c]) => c);

export const TEACHER_COLUMNS: Column[] = [
  { header: 'First name', key: 'firstName', required: true, example: 'Rajeshwari', width: 18 },
  { header: 'Last name', key: 'lastName', required: true, example: 'Balasubramanian', width: 20 },
  { header: 'Email', key: 'email', example: 'r.balasubramanian@school.edu.in', width: 30 },
  { header: 'Phone', key: 'phone', example: '9876543210', width: 14 },
  { header: 'WhatsApp number', key: 'whatsappPhone', example: '9876543210', width: 16 },
  { header: 'WhatsApp messages OK (YES/NO)', key: 'whatsappOptIn', list: ['YES', 'NO'], example: 'YES', width: 14 },
  { header: 'Gender', key: 'gender', list: codes(GENDERS), example: 'FEMALE', width: 10 },
  { header: 'Date of birth', key: 'dob', date: true, example: '1988-03-14', width: 14 },
  { header: 'Blood group', key: 'bloodGroup', list: BLOOD_GROUPS, example: 'B+', width: 10 },
  { header: 'Employee code', key: 'employeeCode', example: 'RPS-T-042', width: 14 },
  { header: 'Post', key: 'designation', list: codes(TEACHER_DESIGNATIONS), example: 'PGT', width: 16 },
  { header: 'Department', key: 'department', example: 'Science', width: 14 },
  { header: 'Employment type', key: 'employmentType', list: codes(EMPLOYMENT_TYPES), example: 'PERMANENT', width: 16 },
  { header: 'Date of joining', key: 'joinedOn', date: true, example: '2019-06-01', width: 14 },
  { header: 'Highest qualification', key: 'highestQualification', example: 'M.Sc Physics', width: 22 },
  { header: 'Professional qualification', key: 'professionalQualification', list: PROFESSIONAL_QUALIFICATIONS, example: 'B.Ed', width: 22 },
  { header: 'TET status', key: 'tetStatus', list: codes(TET_STATUSES), example: 'NOT_REQUIRED', width: 16 },
  { header: 'TET certificate no.', key: 'tetCertificateNo', example: '', width: 18 },
  { header: 'TET valid till', key: 'tetValidTill', date: true, example: '', width: 14 },
  { header: 'Subject specialisation', key: 'specialisation', example: 'Physics', width: 20 },
  { header: 'Years of experience', key: 'experienceYears', example: '11', width: 12 },
  { header: 'Previous school', key: 'previousSchool', example: 'DPS Jaipur', width: 22 },
  { header: 'Address line 1', key: 'addressLine1', example: '12 Vaishali Nagar', width: 24 },
  { header: 'Address line 2', key: 'addressLine2', example: '', width: 20 },
  { header: 'City', key: 'city', example: 'Jaipur', width: 14 },
  { header: 'State', key: 'region', example: 'Rajasthan', width: 14 },
  { header: 'PIN code', key: 'postalCode', example: '302021', width: 10 },
  { header: 'Emergency contact name', key: 'emergencyContactName', example: 'S. Balasubramanian', width: 22 },
  { header: 'Emergency contact phone', key: 'emergencyContactPhone', example: '9876500000', width: 18 },
  { header: 'Emergency contact relation', key: 'emergencyContactRelation', example: 'Spouse', width: 18 },
  { header: 'Police verification', key: 'policeVerification', list: codes(POLICE_VERIFICATION), example: 'CLEARED', width: 16 },
  { header: 'Police verified on', key: 'policeVerifiedOn', date: true, example: '2019-05-20', width: 14 },
  { header: 'Medical fitness on', key: 'medicalFitnessOn', date: true, example: '', width: 14 },
  { header: 'POCSO training on', key: 'pocsoTrainedOn', date: true, example: '', width: 14 },
];

export const STUDENT_COLUMNS: Column[] = [
  { header: 'Admission no.', key: 'admissionNo', required: true, example: 'RPS-2026-0412', width: 16 },
  { header: 'First name', key: 'firstName', required: true, example: 'Aarav', width: 16 },
  { header: 'Last name', key: 'lastName', required: true, example: 'Mehta', width: 16 },
  // Class is named, not id'd: "5" and "B" as the office writes them. The
  // import resolves the pair to a section in the chosen session, and tells
  // the school which pairs it could not find.
  { header: 'Class', key: 'gradeName', example: '5', width: 10 },
  { header: 'Section', key: 'sectionName', example: 'B', width: 10 },
  { header: 'Roll no.', key: 'rollNo', example: '12', width: 10 },
  { header: 'Gender', key: 'gender', list: codes(GENDERS), example: 'MALE', width: 10 },
  { header: 'Date of birth', key: 'dob', date: true, example: '2016-08-21', width: 14 },
  { header: 'Guardian name', key: 'guardianName', example: 'Priya Mehta', width: 20 },
  { header: 'Guardian phone', key: 'guardianPhone', example: '9876543210', width: 16 },
  { header: 'Email', key: 'email', example: 'priya.mehta@example.com', width: 26 },
  { header: "Father's name", key: 'fatherName', example: 'Rohit Mehta', width: 20 },
  { header: "Mother's name", key: 'motherName', example: 'Priya Mehta', width: 20 },
  { header: 'Nationality', key: 'nationality', example: 'Indian', width: 12 },
  { header: 'Category', key: 'category', list: STUDENT_CATEGORIES, example: 'GENERAL', width: 12 },
  { header: 'First admission date', key: 'firstAdmissionDate', date: true, example: '2021-04-05', width: 16 },
  { header: 'First admission class', key: 'firstAdmissionClass', example: 'Nursery', width: 16 },
  { header: 'Previous school', key: 'previousSchool', example: '', width: 20 },
  { header: 'PEN / APAAR id', key: 'penId', example: '', width: 16 },
];

export const CLASS_COLUMNS: Column[] = [
  { header: 'Class', key: 'gradeName', required: true, example: 'Nursery', width: 14 },
  { header: 'Section', key: 'sectionName', required: true, example: 'A', width: 10 },
  { header: 'Class teacher email', key: 'classTeacherEmail', example: 'r.balasubramanian@school.edu.in', width: 30 },
];

export const COLUMNS: Record<SheetKind, Column[]> = { teachers: TEACHER_COLUMNS, students: STUDENT_COLUMNS, classes: CLASS_COLUMNS };

export const INSTRUCTIONS: Record<SheetKind, string[]> = {
  teachers: [
    'One teacher per row on the Data sheet. Do not change the header row.',
    'Only First name and Last name are needed. Fill the rest when you have it — you can always edit a teacher later.',
    'Columns with a dropdown (Post, Employment type, TET status…) only accept the listed values. See the Lists sheet.',
    'Dates are YYYY-MM-DD, e.g. 2019-06-01. Excel date cells also work.',
    'Phone numbers: 10 digits, or with +91. The WhatsApp number is where updates go; leave it blank if it is the same as the phone.',
    'Emails must be unique across your teachers. A teacher only gets a login once an email is on file.',
    'Upload the file on the Onboarding tab. Nothing is created until every row passes the check and you press Import.',
  ],
  students: [
    'One child per row on the Data sheet. Do not change the header row.',
    'Admission no., First name and Last name are needed. Admission numbers must be unique across your school.',
    'Class and Section are the names as you use them ("5" and "B"). They must already exist for the session you import into — the Lists sheet shows what exists today. Leave both blank to admit a child without a class.',
    'Dates are YYYY-MM-DD. Excel date cells also work.',
    'Guardian phone is what the family logs in with; 10 digits, or with +91.',
    'Upload the file on the Onboarding tab, choose the session, and check the preview. Nothing is created until every row passes and you press Import.',
  ],
  classes: [
    'One section per row: the class name and the section letter. "Nursery" + "A", "5" + "B".',
    'A class that does not exist yet is created; a section that already exists for the chosen session is skipped, not duplicated.',
    'Class teacher email is optional and must match a teacher already on file.',
    'Upload the file on the Onboarding tab and choose the session the sections belong to.',
  ],
};

/** Header text → key, forgiving of case, spaces and punctuation. */
export const normHeader = (h: unknown) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export function headerIndex(kind: SheetKind, headers: unknown[]): Map<string, number> {
  const want = new Map(COLUMNS[kind].map((c) => [normHeader(c.header), c.key]));
  const out = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = want.get(normHeader(h));
    if (key && !out.has(key)) out.set(key, i);
  });
  return out;
}
