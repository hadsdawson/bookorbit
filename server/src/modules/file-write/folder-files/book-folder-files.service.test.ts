import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import type { FolderCoverMedia } from '@bookorbit/types';

import { SelfWriteRegistry } from '../../../common/services/self-write-registry.service';
import { FileLockService } from '../file-lock.service';
import { BookFolderFilesService } from './book-folder-files.service';

let root: string;
let folder: string;
let ebookCover: Buffer;
let audioCoverPng: Buffer;

beforeAll(async () => {
  ebookCover = await sharp({ create: { width: 20, height: 30, channels: 3, background: '#336699' } })
    .jpeg()
    .toBuffer();
  audioCoverPng = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#993366' } })
    .png()
    .toBuffer();
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'folder-files-'));
  folder = join(root, 'Neil Gaiman', 'The Ocean');
  await mkdir(folder, { recursive: true });
  await writeFile(join(root, 'ebook.jpg'), ebookCover);
  await writeFile(join(root, 'audio.png'), audioCoverPng);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeService(
  options: { folderCovers?: FolderCoverMedia; metadataJson?: boolean; ownsFolder?: boolean; covers?: ('ebook' | 'audio')[] } = {},
) {
  const covers = options.covers ?? ['ebook', 'audio'];
  const repo = {
    findTarget: vi.fn().mockResolvedValue({
      bookId: 7,
      libraryId: 1,
      folderPath: folder,
      primaryPath: join(folder, 'book.m4b'),
      folderCovers: options.folderCovers ?? 'both',
      metadataJson: options.metadataJson ?? true,
      ownsFolder: options.ownsFolder ?? true,
    }),
    findChapterSource: vi.fn().mockResolvedValue({ chapters: [{ title: 'One', startMs: 0 }], durationSeconds: 90, abridged: false }),
    countLibraryBooks: vi.fn().mockResolvedValue({ total: 5, ownFolder: 3 }),
    findContentFilesAt: vi.fn().mockResolvedValue(new Set<string>()),
    listOwnFolderBookIds: vi.fn().mockImplementation((_libraryId: number, afterId: number) => Promise.resolve(afterId === 0 ? [7, 8, 9] : [])),
  };
  const fileWriteRepo = {
    loadPayload: vi.fn().mockResolvedValue({
      title: 'The Ocean at the End of the Lane',
      subtitle: null,
      description: null,
      publisher: null,
      publishedDate: null,
      publishedYear: 2013,
      language: 'en',
      seriesName: null,
      seriesIndex: null,
      isbn10: null,
      isbn13: null,
      audibleId: null,
      amazonId: null,
      authors: [{ name: 'Neil Gaiman', sortName: 'Gaiman, Neil' }],
      narrators: [],
      genres: [],
      tags: [],
    }),
  };
  const coverStore = {
    resolve: vi.fn((_bookId: number, { medium }: { medium: 'ebook' | 'audio' }) =>
      Promise.resolve(covers.includes(medium) ? join(root, medium === 'ebook' ? 'ebook.jpg' : 'audio.png') : null),
    ),
  };
  const service = new BookFolderFilesService(
    repo as never,
    fileWriteRepo as never,
    coverStore as never,
    new FileLockService(),
    new SelfWriteRegistry(),
  );
  return { service, repo, fileWriteRepo, coverStore };
}

describe('BookFolderFilesService', () => {
  it('writes both covers and a metadata.json into the book folder', async () => {
    const { service } = makeService();
    const outcome = await service.writeForBook(7);

    expect(outcome.status).toBe('written');
    expect(await readFile(join(folder, 'cover-ebook.jpg'))).toEqual(ebookCover);
    const audio = await sharp(await readFile(join(folder, 'cover.jpg'))).metadata();
    expect(audio.format).toBe('jpeg');
    const json = JSON.parse(await readFile(join(folder, 'metadata.json'), 'utf8'));
    expect(json).toMatchObject({ title: 'The Ocean at the End of the Lane', authors: ['Neil Gaiman'], publishedYear: '2013' });
    expect(json.chapters).toEqual([{ id: 0, start: 0, end: 90, title: 'One' }]);
  });

  it('leaves files alone when nothing changed', async () => {
    const { service } = makeService();
    await service.writeForBook(7);
    const before = (await stat(join(folder, 'metadata.json'))).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));

    const outcome = await service.writeForBook(7);

    expect(outcome.status).toBe('unchanged');
    expect((await stat(join(folder, 'metadata.json'))).mtimeMs).toBe(before);
  });

  it('writes only the JSON when covers are off', async () => {
    const { service } = makeService({ folderCovers: 'off' });
    await service.writeForBook(7);
    await expect(stat(join(folder, 'cover.jpg'))).rejects.toThrow();
    await expect(stat(join(folder, 'metadata.json'))).resolves.toBeDefined();
  });

  it('writes only the cover when the JSON is off', async () => {
    const { service, fileWriteRepo } = makeService({ folderCovers: 'ebook', metadataJson: false });
    await service.writeForBook(7);
    expect(await readFile(join(folder, 'cover.jpg'))).toEqual(ebookCover);
    await expect(stat(join(folder, 'metadata.json'))).rejects.toThrow();
    expect(fileWriteRepo.loadPayload).not.toHaveBeenCalled();
  });

  it('never writes over a path registered as a book file, and writes the rest', async () => {
    const { service, repo } = makeService();
    const bookFile = join(folder, 'metadata.json');
    await writeFile(bookFile, 'the real book');
    repo.findContentFilesAt.mockResolvedValue(new Set([bookFile]));

    const outcome = await service.writeForBook(7);

    expect(await readFile(bookFile, 'utf8')).toBe('the real book');
    expect(outcome).toEqual({ status: 'written', files: [join(folder, 'cover.jpg'), join(folder, 'cover-ebook.jpg')] });
    expect(repo.findContentFilesAt).toHaveBeenCalledWith([join(folder, 'cover.jpg'), join(folder, 'cover-ebook.jpg'), bookFile]);
  });

  it('skips the book when every target is a book file', async () => {
    const { service, repo } = makeService({ folderCovers: 'off' });
    const bookFile = join(folder, 'metadata.json');
    repo.findContentFilesAt.mockResolvedValue(new Set([bookFile]));
    await expect(service.writeForBook(7)).resolves.toEqual({ status: 'skipped', reason: 'book file at target' });
    await expect(stat(bookFile)).rejects.toThrow();
  });

  it('skips a book that shares its folder with other books', async () => {
    const { service, coverStore } = makeService({ ownsFolder: false });
    await expect(service.writeForBook(7)).resolves.toEqual({ status: 'skipped', reason: 'shared folder' });
    expect(coverStore.resolve).not.toHaveBeenCalled();
  });

  it('skips when both options are off, without touching the folder', async () => {
    const { service, coverStore } = makeService({ folderCovers: 'off', metadataJson: false });
    await expect(service.writeForBook(7)).resolves.toEqual({ status: 'skipped', reason: 'disabled' });
    expect(coverStore.resolve).not.toHaveBeenCalled();
  });

  it('skips a folder that is not on disk', async () => {
    const { service } = makeService();
    await rm(folder, { recursive: true });
    await expect(service.writeForBook(7)).resolves.toEqual({ status: 'skipped', reason: 'folder missing' });
  });

  it('estimates the run from books that own their folder', async () => {
    const { service } = makeService();
    await expect(service.estimate(1)).resolves.toEqual({ books: 3, sharedFolderBooks: 2, estimatedSeconds: { low: 1, high: 1 } });
  });

  it('writes a whole library in the background and reports progress', async () => {
    const { service, repo } = makeService();
    // Each book owns its own folder, as in a real library, so concurrent writes never share a file.
    repo.findTarget.mockImplementation(async (bookId: number) => {
      const own = join(root, `book-${bookId}`);
      await mkdir(own, { recursive: true });
      return {
        bookId,
        libraryId: 1,
        folderPath: own,
        primaryPath: join(own, 'book.m4b'),
        folderCovers: 'both',
        metadataJson: true,
        ownsFolder: true,
      };
    });
    await mkdir(join(root, 'book-8'), { recursive: true });
    await service.writeForBook(8);
    const started = await service.startWriteAll(1, 42);
    expect(started).toMatchObject({ running: true, total: 3 });

    await vi.waitFor(() => expect(service.status(1)?.running).toBe(false), { timeout: 10_000 });
    expect(service.status(1)).toEqual({ running: false, total: 3, processed: 3, written: 2, unchanged: 1, skipped: 0, failed: 0 });
  });

  it('does not start a second run while one is going', async () => {
    const { service, repo } = makeService();
    const first = await service.startWriteAll(1, 42);
    const second = await service.startWriteAll(1, 42);
    expect(second).toBe(first);
    expect(repo.countLibraryBooks).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(service.status(1)?.running).toBe(false), { timeout: 10_000 });
  });
});
