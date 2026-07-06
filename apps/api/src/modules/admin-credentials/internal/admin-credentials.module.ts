import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth';
import { OwnerHostGuard } from '../../owner/internal/owner-host.guard';
import { AdminCredentialsService } from './admin-credentials.service';
import { AdminCredentialsController } from './admin-credentials.controller';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';

@Module({
  imports: [AuthModule],
  controllers: [AdminCredentialsController, AccountController],
  providers: [AdminCredentialsService, AccountService, OwnerHostGuard],
})
export class AdminCredentialsModule {}
