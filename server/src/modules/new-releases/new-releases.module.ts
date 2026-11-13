import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { AuthModule } from '../auth/auth.module';
import { BookRequestModule } from '../book-request/book-request.module';
import { LibraryModule } from '../library/library.module';
import { MetadataPreferencesModule } from '../metadata-preferences/metadata-preferences.module';
import { NewReleasesAdminController, NewReleasesController } from './new-releases.controller';
import { NewReleasesRepository } from './new-releases.repository';
import { NewReleasesService } from './new-releases.service';
import { ReleaseSourcesService } from './release-sources.service';

@Module({
  imports: [AppSettingsModule, AuthModule, BookRequestModule, LibraryModule, MetadataPreferencesModule],
  controllers: [NewReleasesController, NewReleasesAdminController],
  providers: [NewReleasesRepository, NewReleasesService, ReleaseSourcesService],
})
export class NewReleasesModule {}
