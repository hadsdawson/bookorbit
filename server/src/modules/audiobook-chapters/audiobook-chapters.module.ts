import { Module } from '@nestjs/common';

import { CommonModule } from '../../common/common.module';
import { MetadataScoreModule } from '../metadata-score/metadata-score.module';
import { AudiobookChaptersRepository } from './audiobook-chapters.repository';
import { AudiobookChaptersService } from './audiobook-chapters.service';

@Module({
  imports: [CommonModule, MetadataScoreModule],
  providers: [AudiobookChaptersRepository, AudiobookChaptersService],
  exports: [AudiobookChaptersService],
})
export class AudiobookChaptersModule {}
