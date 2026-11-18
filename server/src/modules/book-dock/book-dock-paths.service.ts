import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { realpath, rmdir } from 'fs/promises';
import { dirname, join } from 'path';

import { removeEmptyDirs } from '../../common/utils/file-move.utils';
import { classifyDockPath } from './library-dock-paths';

/** Where the Book Dock lives on disk, and tidying the folders a unit leaves behind in it. */
@Injectable()
export class BookDockPathsService {
  private rootPromise: Promise<string> | null = null;

  constructor(private readonly config: ConfigService) {}

  /** The real path, since the dock's stored paths are real paths and the setting may be a link. */
  root(): Promise<string> {
    if (!this.rootPromise) {
      const appDataPath = this.config.get<string>('storage.appDataPath') ?? '/data';
      const configured = this.config.get<string>('storage.bookDockPath') ?? join(appDataPath, 'book-dock');
      this.rootPromise = realpath(configured).catch(() => configured);
    }
    return this.rootPromise;
  }

  /**
   * Removes the folder a unit came from, and any parent folders that leaves empty, up to the dock
   * it sat in: the root for Unsorted, or a library's own `_libraries/<folder>`, which outlives its
   * files. `_libraries` itself and the reserved folders are never touched. A folder holding anything
   * besides system leftovers is kept for a person to look at.
   */
  async removeLeftoverFolders(directory: string): Promise<void> {
    const info = classifyDockPath(await this.root(), directory);
    if (info.area !== 'unsorted' && info.area !== 'dock') return;
    await removeEmptyDirs(directory, info.dockRoot);
  }
}

/**
 * Tidies after a unit leaves the dock: its own folder, or for a single file, the folder it sat in.
 * Without the paths service only a unit's own folder is tried, and only that one level.
 */
export async function removeLeftoverFolders(
  paths: BookDockPathsService | undefined,
  row: { unitDirectory: string | null; absolutePath: string },
): Promise<void> {
  if (paths) await paths.removeLeftoverFolders(row.unitDirectory ?? dirname(row.absolutePath));
  else if (row.unitDirectory) await rmdir(row.unitDirectory).catch(() => {});
}
