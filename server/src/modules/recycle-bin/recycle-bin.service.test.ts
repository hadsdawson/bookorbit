import { NotFoundException } from '@nestjs/common';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { listEntryIds, moveToBin } from './lib/recycle-bin-store';
import { RECYCLE_BIN_SETTINGS_KEY, RecycleBinService, parseRecycleBinSettings } from './recycle-bin.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('RecycleBinService', () => {
  let libA: string;
  let libB: string;
  let stored: string | null;

  function makeService() {
    const repo = {
      findLibraryFolders: vi.fn().mockResolvedValue([
        { path: libA, libraryName: 'Books' },
        { path: libB, libraryName: 'Audio' },
        { path: libA, libraryName: 'Books again' },
      ]),
    };
    const appSettings = {
      getValue: vi.fn(() => Promise.resolve(stored)),
      setValue: vi.fn((_key: string, value: string) => {
        stored = value;
        return Promise.resolve();
      }),
    };
    return { service: new RecycleBinService(repo as never, appSettings as never), appSettings };
  }

  async function seed(lib: string, name: string, deletedAt: Date): Promise<string> {
    await writeFile(join(lib, name), name);
    const { id } = await moveToBin(lib, { kind: 'book', title: name, deletedBy: 'Hads', absolutePaths: [join(lib, name)] }, deletedAt);
    return id;
  }

  beforeEach(async () => {
    stored = null;
    libA = await mkdtemp(join(tmpdir(), 'recycle-a-'));
    libB = await mkdtemp(join(tmpdir(), 'recycle-b-'));
  });

  afterEach(async () => {
    await rm(libA, { recursive: true, force: true });
    await rm(libB, { recursive: true, force: true });
  });

  it('is on and keeps entries 30 days until told otherwise', async () => {
    expect(parseRecycleBinSettings(null)).toEqual({ enabled: true, keepDays: 30 });
    expect(parseRecycleBinSettings('{"enabled":false,"keepDays":9999}')).toEqual({ enabled: false, keepDays: 30 });
    const { service, appSettings } = makeService();
    await service.updateSettings({ enabled: false, keepDays: 7 });
    expect(appSettings.setValue).toHaveBeenCalledWith(RECYCLE_BIN_SETTINGS_KEY, '{"enabled":false,"keepDays":7}');
    expect(await service.isEnabled()).toBe(false);
  });

  it('lists entries from every library folder once, newest first, a page at a time', async () => {
    const { service } = makeService();
    const now = Date.now();
    await seed(libA, 'old.epub', new Date(now - 3 * DAY_MS));
    const newest = await seed(libB, 'new.m4b', new Date(now - DAY_MS));
    await seed(libA, 'middle.epub', new Date(now - 2 * DAY_MS));

    const first = await service.overview(1, 2);
    expect(first.total).toBe(3);
    expect(first.entries.map((entry) => entry.title)).toEqual(['new.m4b', 'middle.epub']);
    expect(first.entries[0]).toMatchObject({ id: newest, libraryName: 'Audio', deletedBy: 'Hads', sizeBytes: 7 });
    expect(Date.parse(first.entries[0]!.expiresAt) - Date.parse(first.entries[0]!.deletedAt)).toBe(30 * DAY_MS);
    expect((await service.overview(2, 2)).entries.map((entry) => entry.title)).toEqual(['old.epub']);
  });

  it('restores an entry to its own library folder', async () => {
    const { service } = makeService();
    const id = await seed(libB, 'book.m4b', new Date());

    await expect(service.restore(id)).resolves.toEqual({ restored: 1, conflicts: [], missing: [] });
    expect(await readFile(join(libB, 'book.m4b'), 'utf8')).toBe('book.m4b');
  });

  it('refuses ids that are not entries, including path tricks', async () => {
    const { service } = makeService();
    await mkdir(join(libA, 'keep'));
    await expect(service.restore('../keep')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('000001800000000-deadbeef')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('purges only entries older than the keep period', async () => {
    const { service } = makeService();
    const now = new Date();
    await seed(libA, 'expired.epub', new Date(now.getTime() - 31 * DAY_MS));
    const fresh = await seed(libA, 'fresh.epub', new Date(now.getTime() - 29 * DAY_MS));

    await expect(service.purgeExpired(now)).resolves.toEqual({ removed: 1, failed: 0 });
    expect(await listEntryIds(libA)).toEqual([fresh]);
  });

  it('empties every bin', async () => {
    const { service } = makeService();
    await seed(libA, 'a.epub', new Date());
    await seed(libB, 'b.epub', new Date());

    await expect(service.empty()).resolves.toEqual({ removed: 2, failed: 0 });
    expect((await service.overview()).total).toBe(0);
  });
});
