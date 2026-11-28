import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateReleaseFollowDto, FindReleaseFollowQueryDto, FollowAllDto, ListReleaseFollowsQueryDto } from './dto/follow.dto';
import { SetReleaseStateDto } from './dto/set-release-state.dto';
import { RequestReleaseDto } from './dto/request-release.dto';
import { NewReleasesOverviewQueryDto, UpdateNewReleasesServerSettingsDto, UpdateNewReleasesSettingsDto } from './dto/update-settings.dto';
import { RequestSeriesBooksDto, SeriesBooksQueryDto } from './dto/series-books.dto';
import { NewReleasesService } from './new-releases.service';
import { SeriesBooksService } from './series-books.service';

@Controller('new-releases')
@RequirePermission(Permission.NewReleasesAccess)
export class NewReleasesController {
  constructor(
    private readonly service: NewReleasesService,
    private readonly seriesBooks: SeriesBooksService,
  ) {}

  @Get()
  overview(@CurrentUser() user: RequestUser, @Query() query: NewReleasesOverviewQueryDto) {
    return this.service.overview(user, { includeHidden: query.hidden === 'true' });
  }

  @Put('settings')
  updateSettings(@CurrentUser() user: RequestUser, @Body() dto: UpdateNewReleasesSettingsDto) {
    return this.service.updateUserSettings(user, dto);
  }

  /** Fork: every book of a series and where each stands for this user, for the series pop-up. */
  @Get('series-books')
  listSeriesBooks(@CurrentUser() user: RequestUser, @Query() query: SeriesBooksQueryDto) {
    return this.seriesBooks.list(user, query.name, query.author);
  }

  @Post('series-books/request')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.NewReleasesAccess, Permission.BookRequestAccess)
  requestSeriesBooks(@CurrentUser() user: RequestUser, @Body() dto: RequestSeriesBooksDto) {
    return this.seriesBooks.request(user, dto.name, dto.author, dto.keys);
  }

  @Post(':id/request')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.NewReleasesAccess, Permission.BookRequestAccess)
  requestRelease(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RequestReleaseDto) {
    return this.service.requestRelease(user, id, dto.formats);
  }

  @Get('follows')
  listFollows(@CurrentUser() user: RequestUser, @Query() query: ListReleaseFollowsQueryDto) {
    return this.service.listFollows(user, query);
  }

  /** Whether this user follows one author or series, for the button on its page. */
  @Get('follows/find')
  async findFollow(@CurrentUser() user: RequestUser, @Query() query: FindReleaseFollowQueryDto) {
    return { follow: await this.service.findFollow(user, query.kind, query.name) };
  }

  @Post('follows')
  follow(@CurrentUser() user: RequestUser, @Body() dto: CreateReleaseFollowDto) {
    return this.service.follow(user, dto);
  }

  @Post('follows/all')
  @HttpCode(HttpStatus.OK)
  followAll(@CurrentUser() user: RequestUser, @Body() dto: FollowAllDto) {
    return this.service.followAll(user, dto.kind, dto.includeUnfollowed === true);
  }

  @Delete('follows/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  unfollow(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.unfollow(user, id);
  }

  @Put(':id/state')
  @HttpCode(HttpStatus.NO_CONTENT)
  setState(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SetReleaseStateDto) {
    return this.service.setState(user, id, dto.state);
  }
}

/** The server-wide defaults: what format a new book is requested in, and whether it is requested or suggested. */
@Controller('new-releases/server-settings')
@RequirePermission(Permission.ManageBookRequests)
export class NewReleasesAdminController {
  constructor(private readonly service: NewReleasesService) {}

  @Get()
  get() {
    return this.service.serverSettings();
  }

  @Put()
  update(@Body() dto: UpdateNewReleasesServerSettingsDto) {
    return this.service.updateServerSettings(dto);
  }
}
