import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth';
import { OwnerHostGuard } from '../../owner/internal/owner-host.guard';
import { AdminCredentialsService } from './admin-credentials.service';
import { AdminCredentialsController } from './admin-credentials.controller';

@Module({
  imports: [AuthModule],
  controllers: [AdminCredentialsController],
  providers: [AdminCredentialsService, OwnerHostGuard],
})
export class AdminCredentialsModule {}
