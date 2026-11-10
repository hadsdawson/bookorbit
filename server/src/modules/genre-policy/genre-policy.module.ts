import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { GenrePolicyController } from './genre-policy.controller';
import { GenrePolicyService } from './genre-policy.service';

@Module({
  imports: [AppSettingsModule],
  controllers: [GenrePolicyController],
  providers: [GenrePolicyService],
  exports: [GenrePolicyService],
})
export class GenrePolicyModule {}
