import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features';
import { BackupsCronController, BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';

@Module({
  imports: [FeaturesModule],
  controllers: [BackupsController, BackupsCronController],
  providers: [BackupsService],
  exports: [BackupsService],
})
export class BackupsModule {}
