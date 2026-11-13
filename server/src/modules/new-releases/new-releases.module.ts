import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { LibraryModule } from '../library/library.module';
import { MetadataPreferencesModule } from '../metadata-preferences/metadata-preferences.module';
import { NewReleasesController } from './new-releases.controller';
import { NewReleasesRepository } from './new-releases.repository';
import { NewReleasesService } from './new-releases.service';
import { ReleaseSourcesService } from './release-sources.service';

@Module({
  imports: [AppSettingsModule, LibraryModule, MetadataPreferencesModule],
  controllers: [NewReleasesController],
  providers: [NewReleasesRepository, NewReleasesService, ReleaseSourcesService],
})
export class NewReleasesModule {}
