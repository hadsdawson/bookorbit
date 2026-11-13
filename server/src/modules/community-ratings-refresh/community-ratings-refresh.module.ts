import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { BookModule } from '../book/book.module';
import { CommunityRatingsRefreshController } from './community-ratings-refresh.controller';
import { CommunityRatingsRefreshRepository } from './community-ratings-refresh.repository';
import { CommunityRatingsRefreshService } from './community-ratings-refresh.service';

@Module({
  imports: [AppSettingsModule, BookModule],
  controllers: [CommunityRatingsRefreshController],
  providers: [CommunityRatingsRefreshRepository, CommunityRatingsRefreshService],
})
export class CommunityRatingsRefreshModule {}
