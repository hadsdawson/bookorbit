import { Body, Controller, Get, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { AuditAction, AuditResource, Permission } from '@bookorbit/types';

import { Auditable } from '../../common/decorators/auditable.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { UpdateGenrePolicyDto } from './dto/update-genre-policy.dto';
import { GenrePolicyService } from './genre-policy.service';

@Controller('genre-policy')
export class GenrePolicyController {
  constructor(private readonly service: GenrePolicyService) {}

  /** Read by every metadata editor, so it needs only a signed-in user. */
  @Get()
  get() {
    return this.service.get();
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ManageMetadataConfig)
  @Auditable({ action: AuditAction.AppSettingsUpdate, resource: AuditResource.AppSettings, description: 'Updated allowed genres' })
  update(@Body() dto: UpdateGenrePolicyDto) {
    return this.service.update(dto);
  }
}
