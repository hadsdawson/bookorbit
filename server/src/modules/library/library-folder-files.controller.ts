import { Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { AuditAction, AuditResource, Permission, type FolderFilesEstimate, type FolderFilesStatus } from '@bookorbit/types';

import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireLibraryAccess } from '../../common/decorators/require-library-access.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookFolderFilesService } from '../file-write/folder-files/book-folder-files.service';
import { LibraryService } from './library.service';

/** Writing every book's folder covers and metadata.json at once, after the option is turned on. */
@Controller('libraries')
export class LibraryFolderFilesController {
  constructor(
    private readonly folderFiles: BookFolderFilesService,
    private readonly libraryService: LibraryService,
  ) {}

  @Get(':id/folder-files/estimate')
  @RequireLibraryAccess('editor')
  @RequirePermission(Permission.LibraryEditMetadata)
  async estimate(@Param('id', ParseIntPipe) libraryId: number): Promise<FolderFilesEstimate> {
    await this.assertLibrary(libraryId);
    return this.folderFiles.estimate(libraryId);
  }

  @Get(':id/folder-files/status')
  @RequireLibraryAccess('editor')
  @RequirePermission(Permission.LibraryEditMetadata)
  async status(@Param('id', ParseIntPipe) libraryId: number): Promise<{ status: FolderFilesStatus | null }> {
    await this.assertLibrary(libraryId);
    return { status: this.folderFiles.status(libraryId) };
  }

  @Post(':id/folder-files/write-all')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireLibraryAccess('editor')
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.LibraryWriteMetadataToFiles,
    resource: AuditResource.Library,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Wrote folder covers and metadata.json for library #${req.params['id']}`,
  })
  async writeAll(@Param('id', ParseIntPipe) libraryId: number, @CurrentUser() user: RequestUser): Promise<FolderFilesStatus> {
    await this.assertLibrary(libraryId);
    return this.folderFiles.startWriteAll(libraryId, user.id);
  }

  /** Throws NotFoundException for a library that does not exist. */
  private async assertLibrary(libraryId: number): Promise<void> {
    await this.libraryService.findOne(libraryId);
  }
}
