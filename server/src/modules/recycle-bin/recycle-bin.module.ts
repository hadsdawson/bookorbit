import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { RecycleBinController } from './recycle-bin.controller';
import { RecycleBinRepository } from './recycle-bin.repository';
import { RecycleBinService } from './recycle-bin.service';

@Module({
  imports: [AppSettingsModule],
  controllers: [RecycleBinController],
  providers: [RecycleBinRepository, RecycleBinService],
  exports: [RecycleBinService],
})
export class RecycleBinModule {}
