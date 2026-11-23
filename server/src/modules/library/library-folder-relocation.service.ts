import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { stat } from 'fs/promises';
import { sep } from 'path';
import type { LibraryFolderRelocationPreview, LibraryFolderRelocationResult } from '@bookorbit/types';

import { LibraryOperationGate } from '../../common/services/library-operation-gate.service';
import { mapWithConcurrency } from '../../common/utils/batch.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { LibraryFolder } from '../../db/schema/libraries';
import { PathPolicyService } from '../path/path-policy.service';
import { FileWatcherService } from '../scanner/file-watcher.service';
import { ScannerService } from '../scanner/scanner.service';
import { LibraryFolderRelocationRepository, type RelocationFileRow } from './library-folder-relocation.repository';
import { LibraryLifecycleService } from './library-lifecycle.service';
import { LibraryRepository } from './library.repository';

const PAGE_SIZE = 1000;
const STAT_CONCURRENCY = 16;
const MAX_SAMPLES = 10;
const MTIME_TOLERANCE_MS = 2000;

interface Verification {
  filesFound: number;
  filesMissing: number;
  filesWrongSize: number;
  filesNewerOrOlder: number;
  sampleProblems: string[];
}

function overlaps(a: string, b: string): boolean {
  const left = a.endsWith('/') ? a : `${a}/`;
  const right = b.endsWith('/') ? b : `${b}/`;
  return left.startsWith(right) || right.startsWith(left);
}

@Injectable()
export class LibraryFolderRelocationService {
  private readonly logger = new Logger(LibraryFolderRelocationService.name);

  constructor(
    private readonly repo: LibraryFolderRelocationRepository,
    private readonly libraryRepo: LibraryRepository,
    private readonly pathPolicy: PathPolicyService,
    private readonly lifecycle: LibraryLifecycleService,
    private readonly libraryGate: LibraryOperationGate,
    private readonly scanner: ScannerService,
    private readonly watcher: FileWatcherService,
  ) {}

  async preview(libraryId: number, folderId: number, rawNewPath: string): Promise<LibraryFolderRelocationPreview> {
    const { folder, newPath } = await this.validate(libraryId, folderId, rawNewPath);
    return this.buildPreview(folder, newPath);
  }

  async apply(libraryId: number, folderId: number, rawNewPath: string): Promise<LibraryFolderRelocationResult> {
    const { folder, newPath } = await this.validate(libraryId, folderId, rawNewPath);
    const release = this.libraryGate.tryAcquire(libraryId, 'folder_relocate');
    if (!release) {
      throw new ConflictException({
        message: 'Another operation is running in this library. Try again when it finishes.',
        errorCode: 'LIBRARY_BUSY',
      });
    }

    const event = 'library.folder_relocate';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] libraryId=${libraryId} folderId=${folderId} - library folder relocation started`);
    let result: LibraryFolderRelocationResult;
    try {
      const preview = await this.buildPreview(folder, newPath);
      if (!preview.canApply) {
        throw new ConflictException({
          message: 'The new location does not hold every file yet. Run the preview again to see what is missing.',
          errorCode: 'LIBRARY_RELOCATION_BLOCKED',
        });
      }
      await this.watcher.stopWatcher(libraryId);
      const moved = await this.repo.relocate(folderId, folder.path, newPath);
      this.scanner.forgetLibraryRoots();
      result = { folderId, oldPath: folder.path, newPath, ...moved };
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} folderId=${folderId} durationMs=${Date.now() - startedAt} books=${moved.bookCount} files=${moved.fileCount} - library folder relocated`,
      );
    } catch (err) {
      this.logger.warn(
        `[${event}] [fail] libraryId=${libraryId} folderId=${folderId} durationMs=${Date.now() - startedAt} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - library folder relocation failed`,
      );
      await this.restartWatcher(libraryId);
      throw err;
    } finally {
      release();
    }

    await this.restartWatcher(libraryId);
    this.scanner.startScanAsync(libraryId);
    return result;
  }

  private async restartWatcher(libraryId: number): Promise<void> {
    const [library] = await this.libraryRepo.findById(libraryId);
    if (!library?.watch) return;
    const folders = await this.libraryRepo.findFoldersByLibrary(libraryId);
    await this.watcher.startWatcher(
      libraryId,
      folders.map((f) => f.path),
    );
  }

  private async validate(libraryId: number, folderId: number, rawNewPath: string): Promise<{ folder: LibraryFolder; newPath: string }> {
    const folder = await this.repo.findFolder(libraryId, folderId);
    if (!folder) throw new NotFoundException('Library folder not found');

    const newPath = await this.pathPolicy.assertWithinBrowseRoot(rawNewPath);
    if (newPath === '/' || newPath === folder.path) {
      throw new BadRequestException({ message: 'Choose a different location than the current one.', errorCode: 'LIBRARY_RELOCATION_SAME_PATH' });
    }
    if (overlaps(newPath, folder.path)) {
      throw new BadRequestException({
        message: 'The new location cannot sit inside the current folder or contain it.',
        errorCode: 'LIBRARY_RELOCATION_NESTED',
      });
    }

    const everyFolder = await this.libraryRepo.findAllFolderPaths();
    const clash = everyFolder.find((other) => other.path !== folder.path && overlaps(newPath, other.path));
    if (clash) {
      throw new ConflictException({
        message: 'Library folders cannot sit inside one another or be shared between libraries.',
        errorCode: 'LIBRARY_FOLDER_OVERLAP',
        errorMeta: { path: newPath, overlapPath: clash.path, overlapLibrary: clash.libraryName },
      });
    }
    await this.lifecycle.assertFolderPathsAllowed([newPath]);

    const info = await stat(newPath).catch(() => null);
    if (!info?.isDirectory()) {
      throw new BadRequestException({ message: 'The new location is not a folder the app can read.', errorCode: 'LIBRARY_RELOCATION_NOT_FOUND' });
    }
    return { folder, newPath };
  }

  private async buildPreview(folder: LibraryFolder, newPath: string): Promise<LibraryFolderRelocationPreview> {
    const counts = await this.repo.countFolder(folder.id);
    const pathConflicts = await this.repo.countFilesUnderPath(newPath, folder.id);
    const verification = await this.verifyFiles(folder, newPath);
    const canApply = verification.filesMissing === 0 && verification.filesWrongSize === 0 && pathConflicts === 0;
    return { oldPath: folder.path, newPath, ...counts, ...verification, pathConflicts, canApply };
  }

  private async verifyFiles(folder: LibraryFolder, newPath: string): Promise<Verification> {
    const result: Verification = { filesFound: 0, filesMissing: 0, filesWrongSize: 0, filesNewerOrOlder: 0, sampleProblems: [] };
    const note = (message: string) => {
      if (result.sampleProblems.length < MAX_SAMPLES) result.sampleProblems.push(message);
    };

    let afterId = 0;
    for (;;) {
      const page = await this.repo.findFilesPage(folder.id, afterId, PAGE_SIZE);
      if (page.length === 0) break;
      afterId = page[page.length - 1]!.id;
      await mapWithConcurrency(page, STAT_CONCURRENCY, (file) => this.verifyOne(file, folder.path, newPath, result, note));
    }
    return result;
  }

  private async verifyOne(file: RelocationFileRow, oldPath: string, newPath: string, result: Verification, note: (message: string) => void) {
    if (!file.absolutePath.startsWith(oldPath + sep)) {
      result.filesMissing++;
      note(`Outside the folder: ${file.absolutePath}`);
      return;
    }
    const relative = file.absolutePath.slice(oldPath.length);
    const info = await stat(newPath + relative).catch(() => null);
    if (!info?.isFile()) {
      result.filesMissing++;
      note(`Missing: ${relative.slice(1)}`);
      return;
    }
    if (file.sizeBytes !== null && info.size !== file.sizeBytes) {
      result.filesWrongSize++;
      note(`Different size: ${relative.slice(1)}`);
      return;
    }
    result.filesFound++;
    if (file.mtime && Math.abs(info.mtime.getTime() - file.mtime.getTime()) > MTIME_TOLERANCE_MS) result.filesNewerOrOlder++;
  }
}
