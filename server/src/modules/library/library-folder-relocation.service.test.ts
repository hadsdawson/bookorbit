import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { LibraryOperationGate } from '../../common/services/library-operation-gate.service';
import { LibraryFolderRelocationService } from './library-folder-relocation.service';

describe('LibraryFolderRelocationService', () => {
  let root: string;
  let oldPath: string;
  let newPath: string;

  const repo = {
    findFolder: vi.fn(),
    countFolder: vi.fn(),
    countFilesUnderPath: vi.fn(),
    findFilesPage: vi.fn(),
    relocate: vi.fn(),
  };
  const libraryRepo = {
    findById: vi.fn(),
    findAllFolderPaths: vi.fn(),
    findFoldersByLibrary: vi.fn(),
  };
  const pathPolicy = { assertWithinBrowseRoot: vi.fn((path: string) => Promise.resolve(path)) };
  const lifecycle = { assertFolderPathsAllowed: vi.fn() };
  const scanner = { forgetLibraryRoots: vi.fn(), startScanAsync: vi.fn() };
  const watcher = { stopWatcher: vi.fn(), startWatcher: vi.fn() };
  let gate: LibraryOperationGate;
  let service: LibraryFolderRelocationService;

  const file = (id: number, rel: string, sizeBytes: number | null = 5, mtime: Date | null = null) => ({
    id,
    absolutePath: join(oldPath, rel),
    sizeBytes,
    mtime,
  });

  async function put(rel: string, content = 'hello') {
    await mkdir(join(newPath, rel, '..'), { recursive: true });
    await writeFile(join(newPath, rel), content);
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'relocate-'));
    oldPath = join(root, 'old');
    newPath = join(root, 'new');
    await mkdir(newPath, { recursive: true });

    vi.clearAllMocks();
    gate = new LibraryOperationGate();
    repo.findFolder.mockResolvedValue({ id: 7, libraryId: 1, path: oldPath });
    repo.countFolder.mockResolvedValue({ bookCount: 2, fileCount: 2 });
    repo.countFilesUnderPath.mockResolvedValue(0);
    repo.findFilesPage.mockImplementation((_folderId: number, afterId: number) =>
      Promise.resolve(afterId === 0 ? [file(1, 'A/one.epub'), file(2, 'B/two.m4b')] : []),
    );
    repo.relocate.mockResolvedValue({ bookCount: 2, fileCount: 2 });
    libraryRepo.findById.mockResolvedValue([{ id: 1, watch: true }]);
    libraryRepo.findAllFolderPaths.mockResolvedValue([{ libraryId: 1, path: oldPath, libraryName: 'Shelf' }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 7, path: newPath }]);
    service = new LibraryFolderRelocationService(
      repo as never,
      libraryRepo as never,
      pathPolicy as never,
      lifecycle as never,
      gate,
      scanner as never,
      watcher as never,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('preview', () => {
    it('can apply when every file is in the new location with the same size', async () => {
      await put('A/one.epub');
      await put('B/two.m4b');

      const result = await service.preview(1, 7, newPath);

      expect(result).toMatchObject({
        oldPath,
        newPath,
        bookCount: 2,
        fileCount: 2,
        filesFound: 2,
        filesMissing: 0,
        filesWrongSize: 0,
        canApply: true,
      });
    });

    it('lists missing files and cannot apply', async () => {
      await put('A/one.epub');

      const result = await service.preview(1, 7, newPath);

      expect(result.filesFound).toBe(1);
      expect(result.filesMissing).toBe(1);
      expect(result.sampleProblems).toEqual(['Missing: B/two.m4b']);
      expect(result.canApply).toBe(false);
    });

    it('treats a file of a different size as an unfinished copy', async () => {
      await put('A/one.epub');
      await put('B/two.m4b', 'partial-but-longer');

      const result = await service.preview(1, 7, newPath);

      expect(result.filesWrongSize).toBe(1);
      expect(result.sampleProblems).toEqual(['Different size: B/two.m4b']);
      expect(result.canApply).toBe(false);
    });

    it('only warns when a modified time differs', async () => {
      repo.findFilesPage.mockImplementation((_f: number, afterId: number) =>
        Promise.resolve(afterId === 0 ? [file(1, 'A/one.epub', 5, new Date('2020-01-01T00:00:00Z'))] : []),
      );
      await put('A/one.epub');

      const result = await service.preview(1, 7, newPath);

      expect(result.filesNewerOrOlder).toBe(1);
      expect(result.canApply).toBe(true);
    });

    it('cannot apply when another library already tracks files under the new location', async () => {
      await put('A/one.epub');
      await put('B/two.m4b');
      repo.countFilesUnderPath.mockResolvedValue(3);

      const result = await service.preview(1, 7, newPath);

      expect(result.pathConflicts).toBe(3);
      expect(result.canApply).toBe(false);
    });

    it('walks every page of files', async () => {
      const bigPage = Array.from({ length: 1000 }, (_, i) => file(i + 1, `bulk/${i}.epub`));
      repo.findFilesPage.mockImplementation((_f: number, afterId: number) =>
        Promise.resolve(afterId === 0 ? bigPage : afterId === 1000 ? [file(1001, 'tail.epub')] : []),
      );
      await mkdir(join(newPath, 'bulk'), { recursive: true });
      await Promise.all(bigPage.map((f, i) => writeFile(join(newPath, 'bulk', `${i}.epub`), 'hello')));
      await put('tail.epub');

      const result = await service.preview(1, 7, newPath);

      expect(result.filesFound).toBe(1001);
      expect(repo.findFilesPage).toHaveBeenCalledTimes(3);
    });

    it('rejects an unknown folder', async () => {
      repo.findFolder.mockResolvedValue(undefined);
      await expect(service.preview(1, 7, newPath)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects the current path', async () => {
      await expect(service.preview(1, 7, oldPath)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a location inside or around the current folder', async () => {
      await expect(service.preview(1, 7, join(oldPath, 'sub'))).rejects.toMatchObject({ response: { errorCode: 'LIBRARY_RELOCATION_NESTED' } });
      await expect(service.preview(1, 7, root)).rejects.toMatchObject({ response: { errorCode: 'LIBRARY_RELOCATION_NESTED' } });
    });

    it('rejects a location that overlaps another library folder', async () => {
      libraryRepo.findAllFolderPaths.mockResolvedValue([
        { libraryId: 1, path: oldPath, libraryName: 'Shelf' },
        { libraryId: 2, path: newPath, libraryName: 'Other' },
      ]);
      await expect(service.preview(1, 7, newPath)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a location that is not a folder', async () => {
      await expect(service.preview(1, 7, join(root, 'nope'))).rejects.toMatchObject({ response: { errorCode: 'LIBRARY_RELOCATION_NOT_FOUND' } });
    });
  });

  describe('apply', () => {
    it('rewrites the paths, restarts the watcher and starts a scan once everything is in place', async () => {
      await put('A/one.epub');
      await put('B/two.m4b');

      const result = await service.apply(1, 7, newPath);

      expect(repo.relocate).toHaveBeenCalledWith(7, oldPath, newPath);
      expect(scanner.forgetLibraryRoots).toHaveBeenCalled();
      expect(watcher.startWatcher).toHaveBeenCalledWith(1, [newPath]);
      expect(scanner.startScanAsync).toHaveBeenCalledWith(1);
      expect(result).toEqual({ folderId: 7, oldPath, newPath, bookCount: 2, fileCount: 2 });
      expect(gate.current(1)).toBeNull();
    });

    it('changes nothing while files are missing', async () => {
      await put('A/one.epub');

      await expect(service.apply(1, 7, newPath)).rejects.toMatchObject({ response: { errorCode: 'LIBRARY_RELOCATION_BLOCKED' } });

      expect(repo.relocate).not.toHaveBeenCalled();
      expect(scanner.startScanAsync).not.toHaveBeenCalled();
      expect(gate.current(1)).toBeNull();
    });

    it('refuses while another operation holds the library', async () => {
      gate.tryAcquire(1, 'scan');
      await put('A/one.epub');
      await put('B/two.m4b');

      await expect(service.apply(1, 7, newPath)).rejects.toMatchObject({ response: { errorCode: 'LIBRARY_BUSY' } });

      expect(repo.relocate).not.toHaveBeenCalled();
    });

    it('releases the library and restarts the watcher when the rewrite fails', async () => {
      await put('A/one.epub');
      await put('B/two.m4b');
      repo.relocate.mockRejectedValue(new Error('db down'));

      await expect(service.apply(1, 7, newPath)).rejects.toThrow('db down');

      expect(gate.current(1)).toBeNull();
      expect(watcher.startWatcher).toHaveBeenCalled();
      expect(scanner.startScanAsync).not.toHaveBeenCalled();
    });
  });
});
