import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import type { RecycleBinEmptyResult, RecycleBinOverview, RecycleBinRestoreResult, RecycleBinSettings } from '@bookorbit/types';

import { InteractiveOnly } from '../../common/decorators/api-key-policy.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ListRecycleBinDto, UpdateRecycleBinSettingsDto } from './dto/recycle-bin.dto';
import { RecycleBinService } from './recycle-bin.service';

/**
 * The bin holds deleted books from every library, and emptying it is the one step that cannot be
 * undone, so only a superuser signed in interactively may use it, never an API key.
 */
@Controller('recycle-bin')
@InteractiveOnly()
export class RecycleBinController {
  constructor(private readonly recycleBin: RecycleBinService) {}

  @Get()
  overview(@Query() dto: ListRecycleBinDto, @CurrentUser() user: RequestUser): Promise<RecycleBinOverview> {
    assertSuperuser(user);
    return this.recycleBin.overview(dto.page, dto.pageSize);
  }

  @Put('settings')
  updateSettings(@Body() dto: UpdateRecycleBinSettingsDto, @CurrentUser() user: RequestUser): Promise<RecycleBinSettings> {
    assertSuperuser(user);
    return this.recycleBin.updateSettings(dto);
  }

  @Post('entries/:id/restore')
  @HttpCode(HttpStatus.OK)
  restore(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<RecycleBinRestoreResult> {
    assertSuperuser(user);
    return this.recycleBin.restore(id);
  }

  @Delete('entries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<void> {
    assertSuperuser(user);
    await this.recycleBin.remove(id);
  }

  @Delete('entries')
  empty(@CurrentUser() user: RequestUser): Promise<RecycleBinEmptyResult> {
    assertSuperuser(user);
    return this.recycleBin.empty();
  }
}

function assertSuperuser(user: RequestUser): void {
  if (!user.isSuperuser) throw new ForbiddenException('Only an administrator can manage the recycle bin');
}
