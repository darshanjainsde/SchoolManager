/**
 * THE TEACHER ONBOARDING RECORD — the lists the form, the DTO and the bulk
 * import all validate against. One declaration so a value the console offers
 * is a value the API accepts and the spreadsheet template lists.
 *
 * Posts follow CBSE Affiliation Bye-laws usage (PRT / TGT / PGT and the
 * non-teaching posts a school registers with the board). TET is the RTE s.23
 * / NCTE requirement for classes I–VIII; NOT_REQUIRED covers PGTs and
 * non-teaching posts. Every list ends with a plain fallback so a school is
 * never blocked by a post we did not think of.
 */
export const TEACHER_DESIGNATIONS = [
  ['PRT', 'Primary Teacher (PRT)'],
  ['TGT', 'Trained Graduate Teacher (TGT)'],
  ['PGT', 'Post Graduate Teacher (PGT)'],
  ['PRE_PRIMARY', 'Pre-primary / NTT teacher'],
  ['PRINCIPAL', 'Principal'],
  ['VICE_PRINCIPAL', 'Vice Principal'],
  ['COORDINATOR', 'Coordinator / HOD'],
  ['LIBRARIAN', 'Librarian'],
  ['COUNSELLOR', 'Counsellor / Wellness teacher'],
  ['PET', 'Physical Education Teacher (PET)'],
  ['SPECIAL_EDUCATOR', 'Special Educator'],
  ['LAB_ASSISTANT', 'Lab assistant'],
  ['OTHER', 'Other'],
] as const;
export type TeacherDesignation = (typeof TEACHER_DESIGNATIONS)[number][0];

export const EMPLOYMENT_TYPES = [
  ['PERMANENT', 'Permanent'],
  ['PROBATION', 'On probation'],
  ['CONTRACT', 'Contract'],
  ['PART_TIME', 'Part-time'],
  ['GUEST', 'Guest / visiting'],
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number][0];

export const TET_STATUSES = [
  ['CTET', 'CTET qualified'],
  ['STATE_TET', 'State TET qualified'],
  ['NONE', 'Not yet qualified'],
  ['NOT_REQUIRED', 'Not required for this post'],
] as const;
export type TetStatus = (typeof TET_STATUSES)[number][0];

export const POLICE_VERIFICATION = [
  ['CLEARED', 'Cleared'],
  ['PENDING', 'Pending'],
  ['NOT_REQUIRED', 'Not required'],
] as const;
export type PoliceVerification = (typeof POLICE_VERIFICATION)[number][0];

export const GENDERS = [
  ['FEMALE', 'Female'],
  ['MALE', 'Male'],
  ['OTHER', 'Other'],
] as const;

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export const PROFESSIONAL_QUALIFICATIONS = [
  'B.Ed', 'M.Ed', 'D.El.Ed', 'B.El.Ed', 'NTT', 'D.Ed', 'B.P.Ed', 'M.P.Ed', 'None yet',
] as const;

export const codesOf = <T extends readonly (readonly [string, string])[]>(list: T) => list.map(([c]) => c) as T[number][0][];
