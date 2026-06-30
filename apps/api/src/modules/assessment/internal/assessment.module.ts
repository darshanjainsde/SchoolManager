import { Module } from '@nestjs/common';
import { AssignmentsController } from './assignments.controller';
import { ExamsController } from './exams.controller';

@Module({
  controllers: [AssignmentsController, ExamsController],
})
export class AssessmentModule {}
