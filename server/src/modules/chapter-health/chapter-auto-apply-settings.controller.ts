import { Body, Controller, Get, Put } from '@nestjs/common';
import { Permission, type ChapterAutoApplySettings } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ChapterAutoApplySettingsService } from './chapter-auto-apply-settings.service';
import { UpdateChapterAutoApplySettingsDto } from './dto/chapter-auto-apply-settings.dto';

@Controller('chapter-health/settings')
@RequirePermission(Permission.LibraryEditMetadata)
export class ChapterAutoApplySettingsController {
  constructor(private readonly settings: ChapterAutoApplySettingsService) {}

  @Get()
  get(@CurrentUser() user: RequestUser): Promise<ChapterAutoApplySettings> {
    return this.settings.get(user);
  }

  @Put()
  update(@CurrentUser() user: RequestUser, @Body() dto: UpdateChapterAutoApplySettingsDto): Promise<ChapterAutoApplySettings> {
    return this.settings.update(user, dto.runtimeToleranceSeconds);
  }
}
