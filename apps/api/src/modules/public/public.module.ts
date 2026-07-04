import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features';
import { PublicSiteService } from './public-site.service';
import { PublicSiteController } from './public-site.controller';

@Module({
  imports: [FeaturesModule],
  controllers: [PublicSiteController],
  providers: [PublicSiteService],
})
export class PublicModule {}
