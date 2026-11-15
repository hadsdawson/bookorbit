import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  RECYCLE_BIN_DIR,
  deleteEntry,
  entryDeletedAtMs,
  isEntryId,
  listEntryIds,
  moveToBin,
  newEntryId,
  readManifest,
  restoreEntry,
  safeRelPath,
} from './recycle-bin-store';

async function exists(path: string): Promise<boolean> {
  return readFile(path).then(
    () => true,
    () => false,
  );
}

describe('recycle bin store', () => {
  let lib: string;

  beforeEach(async () => {
    lib = await mkdtemp(join(tmpdir(), 'recycle-bin-'));
    await mkdir(join(lib, 'A', 'Dune'), { recursive: true });
    await writeFile(join(lib, 'A', 'Dune', 'dune.epub'), 'ebook');
    await writeFile(join(lib, 'A', 'Dune', 'dune.m4b'), 'audio!');
  });

  afterEach(async () => {
    await rm(lib, { recursive: true, force: true });
  });

  const input = (paths: string[]) => ({ kind: 'book' as const, title: 'Dune', deletedBy: 'Hads', absolutePaths: paths });

  it('makes ids that sort by deletion time and carry it', () => {
    const id = newEntryId(new Date(1_800_000_000_000));
    expect(isEntryId(id)).toBe(true);
    expect(entryDeletedAtMs(id)).toBe(1_800_000_000_000);
    expect(isEntryId('../etc')).toBe(false);
  });

  it.each(['../x', '/etc/passwd', '', 'a/../../b', '..'])('refuses the unsafe path %j', (path) => {
    expect(safeRelPath(path)).toBeNull();
  });

  it('moves files into a hidden bin, keeping their folders and contents', async () => {
    const { id, moved } = await moveToBin(lib, input([join(lib, 'A', 'Dune', 'dune.epub'), join(lib, 'A', 'Dune', 'dune.m4b')]));

    expect(moved).toBe(2);
    expect(await exists(join(lib, 'A', 'Dune', 'dune.epub'))).toBe(false);
    expect(await readFile(join(lib, RECYCLE_BIN_DIR, id, 'files', 'A', 'Dune', 'dune.m4b'), 'utf8')).toBe('audio!');
    expect(await listEntryIds(lib)).toEqual([id]);
    const manifest = await readManifest(lib, id);
    expect(manifest).toMatchObject({ kind: 'book', title: 'Dune', deletedBy: 'Hads' });
    expect(manifest.files).toEqual([
      { relPath: join('A', 'Dune', 'dune.epub'), sizeBytes: 5 },
      { relPath: join('A', 'Dune', 'dune.m4b'), sizeBytes: 6 },
    ]);
  });

  it('skips files that are already gone and leaves no empty entry behind', async () => {
    const { moved } = await moveToBin(lib, input([join(lib, 'A', 'Dune', 'gone.epub')]));
    expect(moved).toBe(0);
    expect(await listEntryIds(lib)).toEqual([]);
  });

  it('refuses a file outside the library folder and moves nothing', async () => {
    await expect(moveToBin(lib, input([join(lib, 'A', 'Dune', 'dune.epub'), '/etc/hostname']))).rejects.toThrow('outside');
    expect(await exists(join(lib, 'A', 'Dune', 'dune.epub'))).toBe(true);
  });

  it('restores files to where they were and removes the entry', async () => {
    const { id } = await moveToBin(lib, input([join(lib, 'A', 'Dune', 'dune.epub'), join(lib, 'A', 'Dune', 'dune.m4b')]));
    await rm(join(lib, 'A'), { recursive: true });

    const outcome = await restoreEntry(lib, id);

    expect(outcome).toEqual({ restored: 2, conflicts: [], missing: [] });
    expect(await readFile(join(lib, 'A', 'Dune', 'dune.epub'), 'utf8')).toBe('ebook');
    expect(await listEntryIds(lib)).toEqual([]);
    expect(await readdir(lib)).toEqual(['A']);
  });

  it('never replaces a file that took the old path: it stays in the bin and is reported', async () => {
    const { id } = await moveToBin(lib, input([join(lib, 'A', 'Dune', 'dune.epub'), join(lib, 'A', 'Dune', 'dune.m4b')]));
    await writeFile(join(lib, 'A', 'Dune', 'dune.epub'), 'newer copy');

    const outcome = await restoreEntry(lib, id);

    expect(outcome).toEqual({ restored: 1, conflicts: [join('A', 'Dune', 'dune.epub')], missing: [] });
    expect(await readFile(join(lib, 'A', 'Dune', 'dune.epub'), 'utf8')).toBe('newer copy');
    expect(await readFile(join(lib, RECYCLE_BIN_DIR, id, 'files', 'A', 'Dune', 'dune.epub'), 'utf8')).toBe('ebook');
    expect((await readManifest(lib, id)).files).toEqual([{ relPath: join('A', 'Dune', 'dune.epub'), sizeBytes: 5 }]);
  });

  it('ignores manifest paths that point outside the library folder', async () => {
    const { id } = await moveToBin(lib, input([join(lib, 'A', 'Dune', 'dune.epub')]));
    const manifestPath = join(lib, RECYCLE_BIN_DIR, id, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { files: { relPath: string }[] };
    manifest.files.push({ relPath: '../../escape.txt' });
    await writeFile(manifestPath, JSON.stringify(manifest));

    expect((await readManifest(lib, id)).files).toHaveLength(1);
  });

  it('still lists an entry whose manifest is broken, so it can be deleted', async () => {
    const { id } = await moveToBin(lib, input([join(lib, 'A', 'Dune', 'dune.epub')]));
    await writeFile(join(lib, RECYCLE_BIN_DIR, id, 'manifest.json'), '{not json');

    expect(await readManifest(lib, id)).toMatchObject({ id, title: null, files: [] });
    await deleteEntry(lib, id);
    expect(await listEntryIds(lib)).toEqual([]);
  });

  it('deletes an entry for good and tidies the empty bin folder', async () => {
    const { id } = await moveToBin(lib, input([join(lib, 'A', 'Dune', 'dune.epub')]));
    await deleteEntry(lib, id);
    expect(await readdir(lib)).toEqual(['A']);
  });
});
