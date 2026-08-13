import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TenancyModule } from '../../tenancy';
import { PlansModule } from '../../plans';
import { SearchController } from './search.controller';
import { SuggestService } from './suggest.service';

/**
 * Same shape as the other feature modules — see CatalogModule's doc for why the
 * guards' own dependencies must be resolvable here even though the guard
 * classes are auto-registered by `@UseGuards`. No IdempotencyModule: this
 * module has no writes.
 */
@Module({
  imports: [TenancyModule, PlansModule],
  controllers: [SearchController],
  providers: [JwtService, SuggestService],
})
export class SearchModule {}
