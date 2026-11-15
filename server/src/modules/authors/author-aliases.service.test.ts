import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import { AuthorAliasesService } from './author-aliases.service';

const superuser = { id: 1, isSuperuser: true } as RequestUser;
const editor = { id: 3, isSuperuser: false } as RequestUser;

function setup() {
  const aliasesRepo = {
    listForAuthor: vi.fn().mockResolvedValue([{ id: 5, name: 'A.M. Woody' }]),
    findByKey: vi.fn().mockResolvedValue(null),
    findAuthorIdsByNameKey: vi.fn().mockResolvedValue([]),
    add: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(true),
  };
  const authorsRepo = {
    findVisibleAuthorIds: vi.fn((ids: number[]) => Promise.resolve(ids)),
    findRelatedLibraryIds: vi.fn().mockResolvedValue([1]),
  };
  const authorsService = { merge: vi.fn().mockResolvedValue({ mergedAuthorIds: [9], affectedBookCount: 4 }) };
  const libraryService = {
    findAll: vi.fn().mockResolvedValue([{ id: 1 }]),
    findEditableLibraryIds: vi.fn().mockResolvedValue([1]),
  };
  const service = new AuthorAliasesService(aliasesRepo as never, authorsRepo as never, authorsService as never, libraryService as never);
  return { service, aliasesRepo, authorsRepo, authorsService };
}

describe('AuthorAliasesService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('adds a new alternate name with joined initials', async () => {
    await expect(ctx.service.add(editor, 12, ' A. M.  Woody ')).resolves.toEqual({
      aliases: [{ id: 5, name: 'A.M. Woody' }],
      mergedAuthorCount: 0,
      affectedBookCount: 0,
    });
    expect(ctx.aliasesRepo.add).toHaveBeenCalledWith(12, 'A.M. Woody', 'a.m. woody');
    expect(ctx.authorsService.merge).not.toHaveBeenCalled();
  });

  it('folds in an existing author with that name', async () => {
    ctx.aliasesRepo.findAuthorIdsByNameKey.mockResolvedValue([{ id: 9, name: 'A.M. Woody' }]);
    await expect(ctx.service.add(superuser, 12, 'A.M. Woody')).resolves.toEqual(
      expect.objectContaining({ mergedAuthorCount: 1, affectedBookCount: 4 }),
    );
    expect(ctx.authorsService.merge).toHaveBeenCalledWith(superuser, { targetAuthorId: 12, sourceAuthorIds: [9] });
    expect(ctx.aliasesRepo.add).toHaveBeenCalledWith(12, 'A.M. Woody', 'a.m. woody');
  });

  it('leaves combining authors to superusers', async () => {
    ctx.aliasesRepo.findAuthorIdsByNameKey.mockResolvedValue([{ id: 9, name: 'A.M. Woody' }]);
    await expect(ctx.service.add(editor, 12, 'A.M. Woody')).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.aliasesRepo.add).not.toHaveBeenCalled();
  });

  it("refuses the author's own name and a name another author already uses", async () => {
    ctx.aliasesRepo.findAuthorIdsByNameKey.mockResolvedValueOnce([{ id: 12, name: 'Amanda Woody' }]);
    await expect(ctx.service.add(editor, 12, 'amanda woody')).rejects.toBeInstanceOf(BadRequestException);

    ctx.aliasesRepo.findByKey.mockResolvedValueOnce({ id: 7, authorId: 30, authorName: 'Someone Else' });
    await expect(ctx.service.add(editor, 12, 'Pen Name')).rejects.toBeInstanceOf(ConflictException);
  });

  it('removes an alternate name', async () => {
    await expect(ctx.service.remove(editor, 12, 5)).resolves.toEqual([{ id: 5, name: 'A.M. Woody' }]);
    ctx.aliasesRepo.remove.mockResolvedValue(false);
    await expect(ctx.service.remove(editor, 12, 5)).rejects.toBeInstanceOf(NotFoundException);
  });
});
