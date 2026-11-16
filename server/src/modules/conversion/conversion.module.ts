import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { RecycleBinModule } from '../recycle-bin/recycle-bin.module';
import { ConversionController } from './conversion.controller';
import { ConversionService } from './conversion.service';

@Module({
  imports: [AppSettingsModule, RecycleBinModule],
  controllers: [ConversionController],
  providers: [ConversionService],
})
export class ConversionModule {}
