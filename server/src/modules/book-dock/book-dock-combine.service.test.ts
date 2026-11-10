import { BadRequestException } from '@nestjs/common';

import { BookDockCombineService } from './book-dock-combine.service';

const user = { id: 1, isSuperuser: false } as never;

function makeService(options: { canJoinBook?: boolean; previewStatus?: string; primaryFiled?: boolean } = {}) {
  const repo = {
    findByIds: vi.fn().mockResolvedValue([
      { id: 11, fileName: 'Book A.m4b' },
      { id: 12, fileName: 'Book A.epub' },
    ]),
  };
  const finalizeService = {
    previewFinalize: vi.fn().mockImplementation(async (_u: unknown, _s: unknown, _m: unknown, fileIds: number[]) => ({
      items: fileIds.map((fileId) => ({ fileId, status: options.previewStatus ?? 'ready', canJoinBook: options.canJoinBook ?? true })),
    })),
    finalize: vi.fn().mockImplementation(async (_u, _s, _m, fileIds: number[], _a, _e, _l, _f, overrides?: Array<{ joinBook: unknown }>) => ({
      total: fileIds.length,
      succeeded: fileIds.length,
      failed: 0,
      results: fileIds.map((fileId) =>
        overrides || options.primaryFiled !== false
          ? { fileId, fileName: String(fileId), success: true, bookId: 500 }
          : { fileId, fileName: String(fileId), success: false, message: 'Destination exists' },
      ),
    })),
  };
  return { service: new BookDockCombineService(finalizeService as never, repo as never), finalizeService, repo };
}

describe('BookDockCombineService', () => {
  it('files the ebook as the book and adds the audiobook to it', async () => {
    const { service, finalizeService } = makeService();
    const result = await service.combine({ fileIds: [11, 12] }, user, false);

    expect(finalizeService.finalize).toHaveBeenNthCalledWith(
      1,
      1,
      false,
      false,
      [12],
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      user,
    );
    expect(finalizeService.finalize.mock.calls[1]![3]).toEqual([11]);
    expect(finalizeService.finalize.mock.calls[1]![8]).toEqual([{ fileId: 11, joinBook: { bookId: 500 } }]);
    expect(result).toMatchObject({ bookId: 500, primaryFileId: 12, succeeded: 2, failed: 0 });
  });

  it('uses the file the person picked as the primary one', async () => {
    const { service, finalizeService } = makeService();
    const result = await service.combine({ fileIds: [11, 12], primaryFileId: 11 }, user, false);
    expect(finalizeService.finalize.mock.calls[0]![3]).toEqual([11]);
    expect(result.primaryFileId).toBe(11);
  });

  it('moves nothing when the library cannot hold several formats in one book', async () => {
    const { service, finalizeService } = makeService({ canJoinBook: false });
    await expect(service.combine({ fileIds: [11, 12] }, user, false)).rejects.toThrow(BadRequestException);
    expect(finalizeService.finalize).not.toHaveBeenCalled();
  });

  it('moves nothing when the primary file is not ready to file', async () => {
    const { service, finalizeService } = makeService({ previewStatus: 'duplicate' });
    await expect(service.combine({ fileIds: [11, 12] }, user, false)).rejects.toThrow(BadRequestException);
    expect(finalizeService.finalize).not.toHaveBeenCalled();
  });

  it('stops after the primary file when it could not be filed', async () => {
    const { service, finalizeService } = makeService({ primaryFiled: false });
    const result = await service.combine({ fileIds: [11, 12] }, user, false);
    expect(finalizeService.finalize).toHaveBeenCalledTimes(1);
    expect(result.bookId).toBeUndefined();
  });

  it('refuses files that are no longer in the dock', async () => {
    const { service, repo } = makeService();
    repo.findByIds.mockResolvedValue([{ id: 11, fileName: 'Book A.m4b' }]);
    await expect(service.combine({ fileIds: [11, 12] }, user, false)).rejects.toThrow(BadRequestException);
  });
});
