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
});
