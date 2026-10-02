import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features';
import { BackupsCronController, BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { BucketRestoresService } from './bucket-restores.service';
import { SamplePacksService } from './sample-packs.service';

@Module({
  imports: [FeaturesModule],
  controllers: [BackupsController, BackupsCronController],
  providers: [BackupsService, BucketRestoresService, SamplePacksService],
  exports: [BackupsService, BucketRestoresService, SamplePacksService],
})
export class BackupsModule {}
