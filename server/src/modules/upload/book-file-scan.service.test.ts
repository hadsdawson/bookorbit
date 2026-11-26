import { NotFoundException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { MockedFunction } from 'vitest';

vi.mock('fs/promises', () => ({ stat: vi.fn() }));
import { stat } from 'fs/promises';

import { BookFileScanService } from './book-file-scan.service';

const mockStat = stat as MockedFunction<typeof stat>;
const user = { id: 3 } as never;

function makeDb(book: unknown, fileRowsPerCall: { absolutePath: string }[][]) {
  let fileCall = 0;
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue(book ? [book] : []) })) })),
        where: vi.fn(() => Promise.resolve(fileRowsPerCall[fileCall++] ?? [])),
      })),
    })),
  };
}

function makeService(db: unknown, scanStatus: 'scanned' | 'library-scan-running' = 'scanned') {
  const libraryService = { verifyAccessLevel: vi.fn().mockResolvedValue(undefined) };
  const scanner = { scanPathAndWait: vi.fn().mockResolvedValue(scanStatus) };
  const service = new BookFileScanService(db as never, libraryService as never, scanner as never);
  return { service, libraryService, scanner };
}

const BOOK = { id: 9, libraryId: 2, folderPath: '/data/books/T/Weaver/Infinite Wisdom', organizationMode: 'book_per_folder' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

describe('BookFileScanService', () => {
  it('scans the book folder as a directory and reports added and removed files', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => true } as never);
    const db = makeDb(BOOK, [
      [{ absolutePath: `${BOOK.folderPath}/book.m4b` }, { absolutePath: `${BOOK.folderPath}/old.jpg` }],
      [{ absolutePath: `${BOOK.folderPath}/book.m4b` }, { absolutePath: `${BOOK.folderPath}/book.epub` }],
    ]);
    const { service, libraryService, scanner } = makeService(db);

    const result = await service.scanBookFiles(9, user);

    expect(libraryService.verifyAccessLevel).toHaveBeenCalledWith(user, 2, 'editor');
    expect(scanner.scanPathAndWait).toHaveBeenCalledWith('directory', BOOK.folderPath, 2);
    expect(result).toEqual({ status: 'scanned', addedFiles: ['book.epub'], removedFiles: ['old.jpg'], fileCount: 2 });
  });

  it('scans through the file itself when the book is a single loose file', async () => {
    const loosePath = '/data/books/loose.epub';
    mockStat.mockResolvedValue({ isDirectory: () => false } as never);
    const db = makeDb({ ...BOOK, folderPath: loosePath }, [[{ absolutePath: loosePath }], [{ absolutePath: loosePath }]]);
    const { service, scanner } = makeService(db);

    await service.scanBookFiles(9, user);

    expect(scanner.scanPathAndWait).toHaveBeenCalledWith('book', loosePath, 2);
  });

  it('passes on that a library scan is already running', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => true } as never);
    const db = makeDb(BOOK, [[], []]);
    const { service } = makeService(db, 'library-scan-running');

    await expect(service.scanBookFiles(9, user)).resolves.toMatchObject({ status: 'library-scan-running' });
  });

  it('refuses a book that does not exist before checking access', async () => {
    const { service, libraryService } = makeService(makeDb(null, []));

    await expect(service.scanBookFiles(404, user)).rejects.toBeInstanceOf(NotFoundException);
    expect(libraryService.verifyAccessLevel).not.toHaveBeenCalled();
  });
});
