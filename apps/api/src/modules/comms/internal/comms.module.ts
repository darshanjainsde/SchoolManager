import { Module } from '@nestjs/common';
import { CommsController } from './comms.controller';
import { SseBusService } from './sse-bus.service';

@Module({
  providers: [SseBusService],
  controllers: [CommsController],
  exports: [SseBusService],
})
export class CommsModule {}
