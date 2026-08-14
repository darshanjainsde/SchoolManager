import { Module } from '@nestjs/common';
import { FeaturesModule } from '../../features';
import { LibraryOrgService } from './library-org.service';
import { LibraryMeService } from './library-me.service';
import { LibraryMeController } from './library-me.controller';
import { LibraryEnrolmentService } from './library-enrolment.service';
import { LibraryAdminController } from './library-admin.controller';
import { LibraryDeskService } from './library-desk.service';
import { LibraryDeskController } from './library-desk.controller';
import { LibraryRemindersService } from './library-reminders.service';
import { LibraryRemindersController } from './library-reminders.controller';
import { CronSecretGuard } from '../../../common/auth/cron-secret.guard';

/**
 * The library inside Sckools.
 *
 * Keeps its own `internal/` boundary and its own Prisma client (`@library/db`)
 * rather than merging into `@skoolos/db`. That is what keeps the two separable
 * later: if the library ever needs a different scaling or availability profile,
 * splitting it back out stays a routing change instead of a rewrite.
 */
/**
 * `CronSecretGuard` is listed as a PROVIDER here, not brought in by importing
 * `ManagementModule`. Importing that module creates a cycle — management
 * reaches the library through `LibraryOrgService` for the `libraryLive` flag on
 * `/auth/me` — and Nest fails every request in the app with "A circular
 * dependency between modules", not just this route. The guard is a stateless
 * class that reads `process.env.CRON_SECRET`; a second INSTANCE of the same
 * class cannot disagree with the first, which is the only thing worth
 * protecting against here.
 */
@Module({
  imports: [FeaturesModule],
  controllers: [LibraryMeController, LibraryAdminController, LibraryDeskController, LibraryRemindersController],
  providers: [LibraryOrgService, LibraryMeService, LibraryEnrolmentService, LibraryDeskService, LibraryRemindersService, CronSecretGuard],
  exports: [LibraryOrgService],
})
export class LibraryModule {}
