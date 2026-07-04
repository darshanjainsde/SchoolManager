import { Module } from '@nestjs/common';
import { DirectoryService } from './directory.service';
import { DirectoryController } from './directory.controller';

@Module({
  providers: [DirectoryService],
  controllers: [DirectoryController],
})
export class DirectoryModule {}
