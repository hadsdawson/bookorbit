import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import { AuthorLinksService } from './author-links.service';

const user = { id: 3, isSuperuser: false } as RequestUser;

function setup() {
  const linksRepo = {
    findLinkedAuthors: vi.fn().mockResolvedValue([{ id: 12, name: 'Amanda Woody' }]),
    link: vi.fn().mockResolvedValue([9, 12]),
    unlink: vi.fn().mockResolvedValue(true),
    creditGroupOnBooks: vi.fn().mockResolvedValue([101, 102]),
  };
  const authorsRepo = {
    findVisibleAuthorIds: vi.fn((ids: number[]) => Promise.resolve(ids)),
    findRelatedLibraryIds: vi.fn().mockResolvedValue([1]),
  };
  const libraryService = {
    findAll: vi.fn().mockResolvedValue([{ id: 1 }]),
    findEditableLibraryIds: vi.fn().mockResolvedValue([1]),
  };
  const service = new AuthorLinksService(linksRepo as never, authorsRepo as never, libraryService as never);
  return { service, linksRepo, authorsRepo, libraryService };
}

describe('AuthorLinksService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('links two authors and credits the group on their books', async () => {
    await expect(ctx.service.link(user, 9, 12)).resolves.toEqual([{ id: 12, name: 'Amanda Woody' }]);
    expect(ctx.linksRepo.link).toHaveBeenCalledWith(9, 12);
    expect(ctx.linksRepo.creditGroupOnBooks).toHaveBeenCalledWith([9, 12]);
  });

  it('refuses to link an author to itself', async () => {
    await expect(ctx.service.link(user, 9, 9)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hides authors the user cannot see', async () => {
    ctx.authorsRepo.findVisibleAuthorIds.mockResolvedValue([9]);
    await expect(ctx.service.link(user, 9, 12)).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.linksRepo.link).not.toHaveBeenCalled();
  });

  it('needs edit access to every library the authors appear in', async () => {
    ctx.authorsRepo.findRelatedLibraryIds.mockResolvedValue([1, 2]);
    await expect(ctx.service.link(user, 9, 12)).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.linksRepo.link).not.toHaveBeenCalled();
  });

  it('lists only linked authors the user can see', async () => {
    ctx.linksRepo.findLinkedAuthors.mockResolvedValue([
      { id: 12, name: 'Amanda Woody' },
      { id: 13, name: 'Hidden Name' },
    ]);
    ctx.authorsRepo.findVisibleAuthorIds.mockImplementation((ids: number[]) => Promise.resolve(ids.filter((id) => id !== 13)));
    await expect(ctx.service.list(user, 9)).resolves.toEqual([{ id: 12, name: 'Amanda Woody' }]);
  });

  it('reports a pair that is not linked', async () => {
    ctx.linksRepo.unlink.mockResolvedValue(false);
    await expect(ctx.service.unlink(user, 9, 12)).rejects.toBeInstanceOf(NotFoundException);
  });
});
