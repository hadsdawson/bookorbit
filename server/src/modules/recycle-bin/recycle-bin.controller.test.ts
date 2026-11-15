import { ForbiddenException } from '@nestjs/common';

import { RecycleBinController } from './recycle-bin.controller';

function makeController() {
  const recycleBin = {
    overview: vi.fn().mockResolvedValue({ entries: [] }),
    updateSettings: vi.fn((settings: unknown) => Promise.resolve(settings)),
    restore: vi.fn().mockResolvedValue({ restored: 1, conflicts: [], missing: [] }),
    remove: vi.fn().mockResolvedValue(undefined),
    empty: vi.fn().mockResolvedValue({ removed: 0, failed: 0 }),
  };
  return { controller: new RecycleBinController(recycleBin as never), recycleBin };
}

const admin = { id: 1, isSuperuser: true } as never;
const member = { id: 2, isSuperuser: false } as never;
const settings = { enabled: true, keepDays: 30 };

describe('RecycleBinController', () => {
  it('lets a superuser list, restore and delete', async () => {
    const { controller, recycleBin } = makeController();
    await controller.overview({ page: 2, pageSize: 10 }, admin);
    await controller.restore('id-1', admin);
    await controller.remove('id-1', admin);
    expect(recycleBin.overview).toHaveBeenCalledWith(2, 10);
    expect(recycleBin.restore).toHaveBeenCalledWith('id-1');
    expect(recycleBin.remove).toHaveBeenCalledWith('id-1');
  });

  it.each([
    ['overview', (c: RecycleBinController) => c.overview({}, member)],
    ['updateSettings', (c: RecycleBinController) => c.updateSettings(settings, member)],
    ['restore', (c: RecycleBinController) => c.restore('x', member)],
    ['remove', (c: RecycleBinController) => c.remove('x', member)],
    ['empty', (c: RecycleBinController) => c.empty(member)],
  ])('refuses %s for anyone else', async (_name, call) => {
    const { controller, recycleBin } = makeController();
    await expect(Promise.resolve().then(() => call(controller))).rejects.toBeInstanceOf(ForbiddenException);
    expect(recycleBin.restore).not.toHaveBeenCalled();
    expect(recycleBin.remove).not.toHaveBeenCalled();
    expect(recycleBin.empty).not.toHaveBeenCalled();
  });
});
