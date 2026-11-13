import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CommunityRatingsRefreshService } from './community-ratings-refresh.service';
import { SetCommunityRatingsRefreshScheduleDto } from './dto/set-schedule.dto';

// A pass covers every library on the server, so it sits behind the server-wide metadata permission
// rather than a per-library one.
@Controller('community-ratings-refresh')
@RequirePermission(Permission.ManageMetadataConfig)
export class CommunityRatingsRefreshController {
  constructor(private readonly service: CommunityRatingsRefreshService) {}

  @Get()
  status() {
    return this.service.status();
  }

  @Put('schedule')
  setSchedule(@Body() dto: SetCommunityRatingsRefreshScheduleDto) {
    return this.service.setSchedule(dto.schedule);
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  run() {
    return this.service.start('manual');
  }

  @Delete('run')
  cancel() {
    return this.service.cancel();
  }
}
