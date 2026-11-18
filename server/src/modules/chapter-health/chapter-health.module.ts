import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { ChapterEditorModule } from '../chapter-editor/chapter-editor.module';
<<<<<<< HEAD
import { ChapterAutoApplySettingsController } from './chapter-auto-apply-settings.controller';
import { ChapterAutoApplySettingsService } from './chapter-auto-apply-settings.service';
=======
import { JobsModule } from '../jobs/jobs.module';
>>>>>>> upstream/main
import { LibraryModule } from '../library/library.module';
import { ChapterHealthController } from './chapter-health.controller';
import { ChapterHealthRepository } from './chapter-health.repository';
import { ChapterHealthService } from './chapter-health.service';
import { ChapterLookupJobSource } from './chapter-lookup-job-source';
import { ChapterLookupWorker } from './chapter-lookup.worker';

@Module({
<<<<<<< HEAD
  imports: [AppSettingsModule, ChapterEditorModule, LibraryModule],
  controllers: [ChapterHealthController, ChapterAutoApplySettingsController],
  providers: [ChapterHealthRepository, ChapterHealthService, ChapterLookupWorker, ChapterAutoApplySettingsService],
=======
  imports: [ChapterEditorModule, JobsModule, LibraryModule],
  controllers: [ChapterHealthController],
  providers: [ChapterHealthRepository, ChapterHealthService, ChapterLookupJobSource, ChapterLookupWorker],
>>>>>>> upstream/main
})
export class ChapterHealthModule {}
