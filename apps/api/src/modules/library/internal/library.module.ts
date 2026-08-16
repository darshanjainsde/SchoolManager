import { Module } from '@nestjs/common';
import { FeaturesModule } from '../../features';
import { TenancyModule } from '../../tenancy';
import { LibrarianGuard } from './librarian.guard';
import { LibraryCatalogService } from './library-catalog.service';
import { LibraryCirculationService } from './library-circulation.service';
import { LibraryDueSoonService } from './library-due-soon.service';
import { LibraryFinesService } from './library-fines.service';
import { LibraryHallService } from './library-hall.service';
import { LibraryMeService } from './library-me.service';
import { LibrarySettingsService } from './library-settings.service';
import {
  LibraryController,
  LibraryDueSoonController,
  LibraryMeController,
} from './library.controller';

/**
 * The Library Wing (see docs/superpowers/plans/2026-08-16-library-wing-build.md):
 * one librarian login runs the whole library from /library; students and
 * teachers read their own shelf at /me/library. Fully-encapsulated module —
 * siblings import nothing from here except `LibraryModule` via ../index.ts.
 */
@Module({
  imports: [FeaturesModule, TenancyModule],
  controllers: [LibraryController, LibraryMeController, LibraryDueSoonController],
  providers: [
    LibrarianGuard,
    LibrarySettingsService,
    LibraryCatalogService,
    LibraryCirculationService,
    LibraryFinesService,
    LibraryHallService,
    LibraryMeService,
    LibraryDueSoonService,
  ],
})
export class LibraryModule {}
