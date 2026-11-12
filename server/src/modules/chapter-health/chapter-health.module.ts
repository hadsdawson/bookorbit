import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { ChapterEditorModule } from '../chapter-editor/chapter-editor.module';
import { ChapterAutoApplySettingsController } from './chapter-auto-apply-settings.controller';
import { ChapterAutoApplySettingsService } from './chapter-auto-apply-settings.service';
import { LibraryModule } from '../library/library.module';
import { ChapterHealthController } from './chapter-health.controller';
import { ChapterHealthRepository } from './chapter-health.repository';
import { ChapterHealthService } from './chapter-health.service';
import { ChapterLookupWorker } from './chapter-lookup.worker';

@Module({
  imports: [AppSettingsModule, ChapterEditorModule, LibraryModule],
  controllers: [ChapterHealthController, ChapterAutoApplySettingsController],
  providers: [ChapterHealthRepository, ChapterHealthService, ChapterLookupWorker, ChapterAutoApplySettingsService],
})
export class ChapterHealthModule {}
