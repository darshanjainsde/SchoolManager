import { Module } from '@nestjs/common';
import { GradesController } from './grades.controller';
import { ClassesController, SectionsController } from './classes.controller';
import { SubjectsController } from './subjects.controller';
import { EnrollmentsController } from './enrollments.controller';

/**
 * Phase 3 — academic structure. CRUD over grades, classes, sections, subjects,
 * and enrollment. Timetable + ClassSubjectTeacher assignment land in a later
 * follow-up; the Prisma models for ClassSubjectTeacher already exist so that
 * extension is a single controller addition away.
 */
@Module({
  controllers: [
    GradesController,
    ClassesController,
    SectionsController,
    SubjectsController,
    EnrollmentsController,
  ],
})
export class AcademicsModule {}
