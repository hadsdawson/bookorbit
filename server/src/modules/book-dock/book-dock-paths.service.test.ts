import { mkdir, mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { BookDockPathsService, removeLeftoverFolders } from './book-dock-paths.service';

describe('BookDockPathsService', () => {
  let workDir: string;
  let dock: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dock-paths-'));
    dock = join(workDir, 'book-dock');
    await mkdir(dock, { recursive: true });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  function makeService() {
    return new BookDockPathsService({ get: (key: string) => (key === 'storage.bookDockPath' ? dock : undefined) } as never);
  }

  it('removes the unit folder and the parent folders it leaves empty, but never the dock', async () => {
    const unit = join(dock, 'Brandon Sanderson', 'The Way of Kings');
    await mkdir(join(unit, '@eaDir'), { recursive: true });

    await removeLeftoverFolders(makeService(), { unitDirectory: unit, absolutePath: join(unit, 'book.m4b') });

    expect(await readdir(dock)).toEqual([]);
  });

  it('tidies the folder a single file sat in', async () => {
    const folder = join(dock, 'Loose');
    await mkdir(folder);

    await removeLeftoverFolders(makeService(), { unitDirectory: null, absolutePath: join(folder, 'book.epub') });

    expect(await readdir(dock)).toEqual([]);
  });

  it('leaves a folder that still holds a real file', async () => {
    const unit = join(dock, 'Book');
    await mkdir(unit);
    await writeFile(join(unit, 'book-sample.epub'), 'x');

    await removeLeftoverFolders(makeService(), { unitDirectory: unit, absolutePath: join(unit, 'book.epub') });

    expect(await readdir(unit)).toEqual(['book-sample.epub']);
  });

  it('stops at a library dock folder and leaves it in place', async () => {
    const libraryDock = join(dock, '_libraries', 'Fantasy');
    const unit = join(libraryDock, 'Brandon Sanderson', 'The Way of Kings');
    await mkdir(unit, { recursive: true });

    await removeLeftoverFolders(makeService(), { unitDirectory: unit, absolutePath: join(unit, 'book.m4b') });

    expect(await readdir(libraryDock)).toEqual([]);
    expect(await readdir(join(dock, '_libraries'))).toEqual(['Fantasy']);
  });

  it('keeps a library dock folder when a loose file sat directly in it', async () => {
    const libraryDock = join(dock, '_libraries', 'Fantasy');
    await mkdir(libraryDock, { recursive: true });

    await removeLeftoverFolders(makeService(), { unitDirectory: null, absolutePath: join(libraryDock, 'book.epub') });

    expect(await readdir(join(dock, '_libraries'))).toEqual(['Fantasy']);
  });

  it('never removes the _libraries folder', async () => {
    const libraries = join(dock, '_libraries');
    await mkdir(libraries);

    await removeLeftoverFolders(makeService(), { unitDirectory: null, absolutePath: join(libraries, 'book.epub') });

    expect(await readdir(dock)).toEqual(['_libraries']);
  });
});
