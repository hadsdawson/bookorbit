import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Permission, type ConversionJob, type ConversionOverview, type ConversionSettings, type ConversionStatus } from '@bookorbit/types';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { UpdateConversionSettingsDto } from './dto/conversion.dto';
import { ConversionService } from './conversion.service';

/** Finished conversions land in the Book Dock, so the same people who use the dock see them. */
@Controller('conversions')
@RequirePermission(Permission.BookDockAccess)
export class ConversionController {
  constructor(private readonly conversions: ConversionService) {}

  @Get('status')
  async status(): Promise<ConversionStatus> {
    return { enabled: await this.conversions.isEnabled() };
  }

  @Get()
  overview(): Promise<ConversionOverview> {
    return this.conversions.overview();
  }

  @Put('settings')
  @RequirePermission(Permission.ManageBookDock)
  updateSettings(@Body() dto: UpdateConversionSettingsDto): Promise<ConversionSettings> {
    return this.conversions.updateSettings(dto);
  }

  @Post('jobs/:id/retry')
  @HttpCode(HttpStatus.OK)
  retry(@Param('id', new ParseUUIDPipe()) id: string): ConversionJob {
    return this.conversions.retry(id);
  }
}
