import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { SeriesReviewController } from './series-review.controller';
import { SeriesReviewRepository } from './series-review.repository';
import { SeriesReviewService } from './series-review.service';

@Module({
  imports: [BookModule, LibraryModule],
  controllers: [SeriesReviewController],
  providers: [SeriesReviewService, SeriesReviewRepository],
})
export class SeriesReviewModule {}
