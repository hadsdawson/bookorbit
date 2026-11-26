import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';

import { Permission } from '@bookorbit/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ListMixedSeriesDto, ListWaitingBooksDto } from './dto/list-series-review.dto';
import { ResolveWaitingSeriesDto } from './dto/resolve-waiting-series.dto';
import { SeriesReviewService } from './series-review.service';

@Controller('series-review')
@RequirePermission(Permission.LibraryEditMetadata)
export class SeriesReviewController {
  constructor(private readonly service: SeriesReviewService) {}

  @Get('mixed')
  findMixed(@CurrentUser() user: RequestUser, @Query() dto: ListMixedSeriesDto) {
    return this.service.findMixed(user, dto);
  }

  @Post('mixed/:seriesId/fine')
  @HttpCode(204)
  markFine(@CurrentUser() user: RequestUser, @Param('seriesId', ParseIntPipe) seriesId: number) {
    return this.service.markFine(user, seriesId);
  }

  @Delete('mixed/:seriesId/fine')
  @HttpCode(204)
  unmarkFine(@CurrentUser() user: RequestUser, @Param('seriesId', ParseIntPipe) seriesId: number) {
    return this.service.unmarkFine(user, seriesId);
  }

  @Get('waiting')
  findWaiting(@CurrentUser() user: RequestUser, @Query() dto: ListWaitingBooksDto) {
    return this.service.findWaiting(user, dto);
  }

  @Post('waiting/resolve')
  resolveWaiting(@CurrentUser() user: RequestUser, @Body() dto: ResolveWaitingSeriesDto) {
    return this.service.resolveWaiting(user, dto);
  }
}
