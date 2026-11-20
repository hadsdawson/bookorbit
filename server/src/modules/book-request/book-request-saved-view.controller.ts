import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookRequestSavedViewService } from './book-request-saved-view.service';
import { SaveBookRequestViewDto } from './dto/save-book-request-view.dto';

@Controller('book-request-saved-views')
@RequirePermission(Permission.BookRequestAccess)
export class BookRequestSavedViewController {
  constructor(private readonly service: BookRequestSavedViewService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user.id);
  }

  @Post()
  save(@Body() dto: SaveBookRequestViewDto, @CurrentUser() user: RequestUser) {
    return this.service.save(user.id, dto.name, dto.filters);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.service.remove(user.id, id);
  }
}
