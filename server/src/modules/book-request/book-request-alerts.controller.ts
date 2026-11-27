import { Body, Controller, Get, Param, ParseEnumPipe, Post, Put } from '@nestjs/common';
import { AuditAction, AuditResource, Permission } from '@bookorbit/types';
import type { BookRequestAlertChannel } from '@bookorbit/types';

import { Auditable } from '../../common/decorators/auditable.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { BookRequestAlertService } from './book-request-alerts.service';
import { UpdateBookRequestAlertSettingsDto } from './dto/book-request-alerts.dto';

/**
 * Fork. Gated on `ManageAppSettings` like the automation settings: where the instance posts
 * messages to is instance configuration. Its own path so the `admin/book-requests/:id` routes
 * do not swallow it.
 */
@Controller('admin/book-request-alerts')
@RequirePermission(Permission.ManageAppSettings)
export class BookRequestAlertController {
  constructor(private readonly alerts: BookRequestAlertService) {}

  @Get()
  get() {
    return this.alerts.getSettings();
  }

  @Put()
  @Auditable({
    action: AuditAction.AppSettingsUpdate,
    resource: AuditResource.AppSettings,
    description: 'Updated book request alert settings',
  })
  update(@Body() dto: UpdateBookRequestAlertSettingsDto) {
    return this.alerts.updateSettings(dto);
  }

  @Post('test/:channel')
  test(@Param('channel', new ParseEnumPipe({ discord: 'discord', email: 'email' })) channel: BookRequestAlertChannel) {
    return this.alerts.sendTest(channel);
  }
}
