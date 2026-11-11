import { NotFoundException } from '@nestjs/common';

import { LibraryFolderFilesController } from './library-folder-files.controller';

function makeController(libraryExists = true) {
  const folderFiles = {
    estimate: vi.fn().mockResolvedValue({ books: 3, sharedFolderBooks: 1, estimatedSeconds: { low: 1, high: 2 } }),
    status: vi.fn().mockReturnValue(null),
    startWriteAll: vi.fn().mockResolvedValue({ running: true, total: 3, processed: 0, written: 0, unchanged: 0, skipped: 0, failed: 0 }),
  };
  const libraryService = {
    findOne: libraryExists ? vi.fn().mockResolvedValue({ id: 1 }) : vi.fn().mockRejectedValue(new NotFoundException('Library not found')),
  };
  return { controller: new LibraryFolderFilesController(folderFiles as never, libraryService as never), folderFiles };
}

describe('LibraryFolderFilesController', () => {
  it('returns the estimate for a library', async () => {
    const { controller } = makeController();
    await expect(controller.estimate(1)).resolves.toMatchObject({ books: 3, sharedFolderBooks: 1 });
  });

  it('wraps the status so an idle library answers with null', async () => {
    const { controller } = makeController();
    await expect(controller.status(1)).resolves.toEqual({ status: null });
  });

  it('starts the write-all run for the signed-in user', async () => {
    const { controller, folderFiles } = makeController();
    await controller.writeAll(1, { id: 42 } as never);
    expect(folderFiles.startWriteAll).toHaveBeenCalledWith(1, 42);
  });

  it('refuses a library that does not exist', async () => {
    const { controller, folderFiles } = makeController(false);
    await expect(controller.writeAll(9, { id: 42 } as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(folderFiles.startWriteAll).not.toHaveBeenCalled();
  });
});
