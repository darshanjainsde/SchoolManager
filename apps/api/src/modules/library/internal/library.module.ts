import { Module } from '@nestjs/common';
import { FeaturesModule } from '../../features';
import { LibraryOrgService } from './library-org.service';
import { LibraryMeService } from './library-me.service';
import { LibraryMeController } from './library-me.controller';

/**
 * The library inside Sckools.
 *
 * Keeps its own `internal/` boundary and its own Prisma client (`@library/db`)
 * rather than merging into `@skoolos/db`. That is what keeps the two separable
 * later: if the library ever needs a different scaling or availability profile,
 * splitting it back out stays a routing change instead of a rewrite.
 */
@Module({
  imports: [FeaturesModule],
  controllers: [LibraryMeController],
  providers: [LibraryOrgService, LibraryMeService],
  exports: [LibraryOrgService],
})
export class LibraryModule {}
