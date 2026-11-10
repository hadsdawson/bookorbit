import { BookDockDefaultTargetService } from './book-dock-default-target.service';

function makeService(target: { libraryId: number; folderId: number } | null) {
  const repo = {
    findSoleLibraryTarget: vi.fn().mockResolvedValue(target),
    assignTargetToUnassigned: vi.fn().mockResolvedValue(2),
  };
  return { service: new BookDockDefaultTargetService(repo as never), repo };
}

describe('BookDockDefaultTargetService', () => {
  it('gives unassigned files the only library and folder', async () => {
    const { service, repo } = makeService({ libraryId: 1, folderId: 3 });
    await service.apply();
    expect(repo.assignTargetToUnassigned).toHaveBeenCalledWith(1, 3);
  });

  it('assigns nothing when there is a choice to make', async () => {
    const { service, repo } = makeService(null);
    await service.apply();
    expect(repo.assignTargetToUnassigned).not.toHaveBeenCalled();
  });

  it('checks at most once a minute from the list path', async () => {
    const { service, repo } = makeService({ libraryId: 1, folderId: 3 });
    await service.applyThrottled();
    await service.applyThrottled();
    expect(repo.findSoleLibraryTarget).toHaveBeenCalledTimes(1);
  });

  it('never fails the caller', async () => {
    const { service, repo } = makeService(null);
    repo.findSoleLibraryTarget.mockRejectedValue(new Error('db down'));
    await expect(service.apply()).resolves.toBeUndefined();
  });
});
