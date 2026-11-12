import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { createReadStream } from 'fs';
import type { Readable } from 'stream';
import { AuditAction, AuditResource, type BackupInfo, type BackupOverview, type BackupSettings } from '@bookorbit/types';

import { InteractiveOnly } from '../../common/decorators/api-key-policy.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { MultipartRequest } from '../../common/types/multipart-request';
import type { RequestUser } from '../../common/types/request-user';
import { BackupService } from './backup.service';
import { UpdateBackupSettingsDto } from './dto/update-backup-settings.dto';

/** Uploads bigger than this are refused; a backup holds the database and covers, not books. */
const MAX_BACKUP_UPLOAD_BYTES = 20 * 1024 * 1024 * 1024;

/**
 * Backups hold every user's data and a restore replaces all of it, so only a superuser signed in
 * interactively may use them, never an API key.
 */
@Controller('backups')
@InteractiveOnly()
export class BackupController {
  constructor(private readonly backups: BackupService) {}

  @Get()
  overview(@CurrentUser() user: RequestUser): Promise<BackupOverview> {
    assertSuperuser(user);
    return this.backups.overview();
  }

  @Put('settings')
  saveSettings(@CurrentUser() user: RequestUser, @Body() dto: UpdateBackupSettingsDto): Promise<BackupSettings> {
    assertSuperuser(user);
    return this.backups.saveSettings(dto);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: RequestUser): Promise<BackupInfo> {
    assertSuperuser(user);
    return this.backups.create('manual');
  }

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  async upload(@CurrentUser() user: RequestUser, @Req() req: MultipartRequest): Promise<BackupInfo> {
    assertSuperuser(user);
    const data = await req.file({ limits: { fileSize: MAX_BACKUP_UPLOAD_BYTES } });
    if (!data) throw new BadRequestException('No file provided');
    const file = data.file as unknown as Readable & { truncated?: boolean };
    return this.backups.upload(file, () => file.truncated === true);
  }

  @Get(':name/download')
  async download(@CurrentUser() user: RequestUser, @Param('name') name: string, @Res() reply: FastifyReply): Promise<void> {
    assertSuperuser(user);
    const { path, size } = await this.backups.pathFor(name);
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Length', String(size));
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    reply.header('Cache-Control', 'no-store');
    await reply.send(createReadStream(path));
  }

  @Delete(':name')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.AppSettingsUpdate,
    resource: AuditResource.AppSettings,
    description: (req) => `Deleted backup ${String(req.params['name'])}`,
  })
  remove(@CurrentUser() user: RequestUser, @Param('name') name: string): Promise<void> {
    assertSuperuser(user);
    return this.backups.remove(name);
  }

  @Post(':name/restore')
  @HttpCode(HttpStatus.ACCEPTED)
  @Auditable({
    action: AuditAction.AppSettingsUpdate,
    resource: AuditResource.AppSettings,
    description: (req) => `Restored backup ${String(req.params['name'])}`,
  })
  restore(@CurrentUser() user: RequestUser, @Param('name') name: string): Promise<{ restarting: true }> {
    assertSuperuser(user);
    return this.backups.restore(name);
  }
}

function assertSuperuser(user: RequestUser): void {
  if (!user.isSuperuser) throw new ForbiddenException('Only an administrator can manage backups');
}
