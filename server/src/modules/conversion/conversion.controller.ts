import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Readable } from 'stream';
import { Permission, type ConversionJob, type ConversionOverview, type ConversionSettings, type ConversionStatus } from '@bookorbit/types';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { MultipartRequest } from '../../common/types/multipart-request';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { ConversionUploadService } from './conversion-upload.service';
import { UpdateConversionSettingsDto } from './dto/conversion.dto';
import { ConversionService } from './conversion.service';

/** Finished conversions land in the Book Dock, so the same people who use the dock see them. */
@Controller('conversions')
@RequirePermission(Permission.BookDockAccess)
export class ConversionController {
  constructor(
    private readonly conversions: ConversionService,
    private readonly uploads: ConversionUploadService,
    private readonly appSettings: AppSettingsService,
  ) {}

  @Get('status')
  async status(): Promise<ConversionStatus> {
    return { enabled: await this.conversions.isEnabled(), active: this.conversions.activeCount() };
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

  @Post('uploads')
  @RequirePermission(Permission.BookDockAccess, Permission.LibraryUpload)
  startUpload(): Promise<{ batchId: string }> {
    return this.uploads.start();
  }

  /** One file per request; `path` is where it sits inside what was picked, such as `Book/01.mp3`. */
  @Post('uploads/:batchId/files')
  @RequirePermission(Permission.BookDockAccess, Permission.LibraryUpload)
  @HttpCode(HttpStatus.NO_CONTENT)
  async uploadFile(@Param('batchId', new ParseUUIDPipe()) batchId: string, @Query('path') path: string, @Req() req: MultipartRequest): Promise<void> {
    if (typeof path !== 'string' || !path) throw new BadRequestException('A file path is required');
    const limitBytes = (await this.appSettings.getMaxUploadSizeMb()) * 1024 * 1024;
    const data = await req.file({ limits: { fileSize: limitBytes } });
    if (!data) throw new BadRequestException('No file provided');
    await this.uploads.receive(batchId, path, data.file as unknown as Readable, limitBytes);
  }

  @Post('uploads/:batchId/finish')
  @RequirePermission(Permission.BookDockAccess, Permission.LibraryUpload)
  @HttpCode(HttpStatus.OK)
  finishUpload(@Param('batchId', new ParseUUIDPipe()) batchId: string): Promise<{ items: number }> {
    return this.uploads.finish(batchId);
  }

  @Delete('uploads/:batchId')
  @RequirePermission(Permission.BookDockAccess, Permission.LibraryUpload)
  @HttpCode(HttpStatus.NO_CONTENT)
  cancelUpload(@Param('batchId', new ParseUUIDPipe()) batchId: string): Promise<void> {
    return this.uploads.cancel(batchId);
  }
}
