import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { BackupController } from './backup.controller';
import { BackupRepository } from './backup.repository';
import { BackupService } from './backup.service';

@Module({
  imports: [AppSettingsModule],
  controllers: [BackupController],
  providers: [BackupRepository, BackupService],
})
export class BackupModule {}
