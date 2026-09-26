import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy';
import { AdminConcernsController, FamilyConcernsController, TeacherConcernsController } from './concerns.controller';
import { ConcernsService } from './concerns.service';

/**
 * The Complaint Box. Its own module rather than another room inside
 * management: the family and teacher doors are not management routes, and the
 * service has no dependency on anything in there.
 */
@Module({
  imports: [TenancyModule],
  controllers: [AdminConcernsController, TeacherConcernsController, FamilyConcernsController],
  providers: [ConcernsService],
  exports: [ConcernsService],
})
export class ConcernsModule {}
