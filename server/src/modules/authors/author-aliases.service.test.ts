import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import { AuthorAliasesService } from './author-aliases.service';

const superuser = { id: 1, isSuperuser: true } as RequestUser;
const editor = { id: 3, isSuperuser: false } as RequestUser;

function setup() {
  const aliasesRepo = {
    listForAuthor: vi.fn().mockResolvedValue([{ id: 5, name: 'A.M. Woody' }]),
    listPenNames: vi.fn().mockResolvedValue([]),
    listPenNameOf: vi.fn().mockResolvedValue([]),
    findByKey: vi.fn().mockResolvedValue(null),
    findAuthorIdsByNameKey: vi.fn().mockResolvedValue([]),
    add: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(true),
    isPenName: vi.fn().mockResolvedValue(false),
    hasPenNames: vi.fn().mockResolvedValue(false),
    linkPenName: vi.fn().mockResolvedValue(undefined),
    unlinkPenName: vi.fn().mockResolvedValue(true),
    createAuthor: vi.fn().mockResolvedValue({ id: 40, name: 'A. Deborah Baker' }),
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

  it('lists every other name an author goes by', async () => {
    ctx.aliasesRepo.listPenNames.mockResolvedValue([{ id: 40, name: 'A. Deborah Baker', bookCount: 3 }]);
    await expect(ctx.service.names(editor, 12)).resolves.toEqual({
      spellings: [{ id: 5, name: 'A.M. Woody' }],
      penNames: [{ id: 40, name: 'A. Deborah Baker', bookCount: 3 }],
      penNameOf: [],
    });
    expect(ctx.aliasesRepo.listPenNames).toHaveBeenCalledWith(12, [1]);
  });

  describe('spellings', () => {
    it('adds a new spelling with joined initials', async () => {
      await expect(ctx.service.addName(editor, 12, ' A. M.  Woody ', 'spelling')).resolves.toEqual(
        expect.objectContaining({ mergedAuthorCount: 0, affectedBookCount: 0, openAuthorId: null }),
      );
      expect(ctx.aliasesRepo.add).toHaveBeenCalledWith(12, 'A.M. Woody', 'a.m. woody');
      expect(ctx.authorsService.merge).not.toHaveBeenCalled();
    });

    it('folds in an existing author with that name, for superusers only', async () => {
      ctx.aliasesRepo.findAuthorIdsByNameKey.mockResolvedValue([{ id: 9, name: 'A.M. Woody' }]);
      await expect(ctx.service.addName(editor, 12, 'A.M. Woody', 'spelling')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(ctx.service.addName(superuser, 12, 'A.M. Woody', 'spelling')).resolves.toEqual(
        expect.objectContaining({ mergedAuthorCount: 1, affectedBookCount: 4 }),
      );
      expect(ctx.authorsService.merge).toHaveBeenCalledWith(superuser, { targetAuthorId: 12, sourceAuthorIds: [9] });
    });

    it('removes a spelling', async () => {
      await expect(ctx.service.removeSpelling(editor, 12, 5)).resolves.toEqual(
        expect.objectContaining({ spellings: [{ id: 5, name: 'A.M. Woody' }] }),
      );
      ctx.aliasesRepo.remove.mockResolvedValue(false);
      await expect(ctx.service.removeSpelling(editor, 12, 5)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('pen names', () => {
    it('links an existing author as a pen name without touching their books', async () => {
      ctx.aliasesRepo.findAuthorIdsByNameKey.mockResolvedValue([{ id: 40, name: 'A. Deborah Baker' }]);
      await ctx.service.addName(editor, 12, 'A. Deborah Baker', 'penName');
      expect(ctx.aliasesRepo.linkPenName).toHaveBeenCalledWith(40, 12);
      expect(ctx.aliasesRepo.createAuthor).not.toHaveBeenCalled();
      expect(ctx.authorsService.merge).not.toHaveBeenCalled();
    });

    it('creates the pen name when no author has it yet', async () => {
      await ctx.service.addName(editor, 12, 'A. Deborah Baker', 'penName');
      expect(ctx.aliasesRepo.createAuthor).toHaveBeenCalledWith('A. Deborah Baker');
      expect(ctx.aliasesRepo.linkPenName).toHaveBeenCalledWith(40, 12);
    });

    it('lets a pen name belong to more than one person', async () => {
      ctx.aliasesRepo.findAuthorIdsByNameKey.mockResolvedValue([{ id: 40, name: 'James S.A. Corey' }]);
      await ctx.service.addName(editor, 12, 'James S.A. Corey', 'penName');
      await ctx.service.addName(editor, 13, 'James S.A. Corey', 'penName');
      expect(ctx.aliasesRepo.linkPenName).toHaveBeenCalledWith(40, 12);
      expect(ctx.aliasesRepo.linkPenName).toHaveBeenCalledWith(40, 13);
    });

    it('refuses pen names of a pen name, and a person with pen names as a pen name', async () => {
      ctx.aliasesRepo.isPenName.mockResolvedValueOnce(true);
      await expect(ctx.service.addName(editor, 12, 'Someone', 'penName')).rejects.toBeInstanceOf(BadRequestException);

      ctx.aliasesRepo.findAuthorIdsByNameKey.mockResolvedValue([{ id: 40, name: 'Seanan McGuire' }]);
      ctx.aliasesRepo.hasPenNames.mockResolvedValueOnce(true);
      await expect(ctx.service.addName(editor, 12, 'Seanan McGuire', 'penName')).rejects.toBeInstanceOf(BadRequestException);
      expect(ctx.aliasesRepo.linkPenName).not.toHaveBeenCalled();
    });

    it('unties a pen name from either side', async () => {
      await ctx.service.unlinkPenName(editor, 12, 40);
      expect(ctx.aliasesRepo.unlinkPenName).toHaveBeenCalledWith(40, 12);

      ctx.aliasesRepo.unlinkPenName.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      await ctx.service.unlinkPenName(editor, 40, 12);
      expect(ctx.aliasesRepo.unlinkPenName).toHaveBeenLastCalledWith(40, 12);

      ctx.aliasesRepo.unlinkPenName.mockResolvedValue(false);
      await expect(ctx.service.unlinkPenName(editor, 12, 41)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('main names', () => {
    it('makes this author a pen name of a new main name and opens its page', async () => {
      ctx.aliasesRepo.createAuthor.mockResolvedValue({ id: 50, name: 'James Elroy' });
      await expect(ctx.service.addName(editor, 12, 'James Elroy', 'mainName')).resolves.toEqual(expect.objectContaining({ openAuthorId: 50 }));
      expect(ctx.aliasesRepo.linkPenName).toHaveBeenCalledWith(12, 50);
    });

    it('refuses when this author has pen names, or the main name is a pen name', async () => {
      ctx.aliasesRepo.hasPenNames.mockResolvedValueOnce(true);
      await expect(ctx.service.addName(editor, 12, 'James Elroy', 'mainName')).rejects.toBeInstanceOf(BadRequestException);

      ctx.aliasesRepo.findAuthorIdsByNameKey.mockResolvedValue([{ id: 50, name: 'James Elroy' }]);
      ctx.aliasesRepo.isPenName.mockResolvedValueOnce(true);
      await expect(ctx.service.addName(editor, 12, 'James Elroy', 'mainName')).rejects.toBeInstanceOf(BadRequestException);
      expect(ctx.aliasesRepo.linkPenName).not.toHaveBeenCalled();
    });
  });

  it("refuses the author's own name and a name that is already another author's spelling", async () => {
    ctx.aliasesRepo.findAuthorIdsByNameKey.mockResolvedValueOnce([{ id: 12, name: 'Amanda Woody' }]);
    await expect(ctx.service.addName(editor, 12, 'amanda woody', 'penName')).rejects.toBeInstanceOf(BadRequestException);

    ctx.aliasesRepo.findByKey.mockResolvedValueOnce({ id: 7, authorId: 30, authorName: 'Someone Else' });
    await expect(ctx.service.addName(editor, 12, 'Pen Name', 'penName')).rejects.toBeInstanceOf(ConflictException);
  });
});
