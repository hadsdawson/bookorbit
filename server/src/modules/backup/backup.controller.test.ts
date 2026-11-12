import { ForbiddenException } from '@nestjs/common';

import { BackupController } from './backup.controller';

function makeController() {
  const backups = {
    overview: vi.fn().mockResolvedValue({ backups: [] }),
    saveSettings: vi.fn((settings: unknown) => Promise.resolve(settings)),
    create: vi.fn().mockResolvedValue({ name: 'b.zip' }),
    remove: vi.fn().mockResolvedValue(undefined),
    restore: vi.fn().mockResolvedValue({ restarting: true }),
  };
  return { controller: new BackupController(backups as never), backups };
}

const admin = { id: 1, isSuperuser: true } as never;
const member = { id: 2, isSuperuser: false } as never;

describe('BackupController', () => {
  it('lets a superuser see, make and restore backups', async () => {
    const { controller, backups } = makeController();
    await controller.overview(admin);
    await controller.create(admin);
    await controller.restore(admin, 'bookorbit-backup-x.zip');
    expect(backups.create).toHaveBeenCalledWith('manual');
    expect(backups.restore).toHaveBeenCalledWith('bookorbit-backup-x.zip');
  });

  it.each([
    ['overview', (c: BackupController) => c.overview(member)],
    ['create', (c: BackupController) => c.create(member)],
    ['restore', (c: BackupController) => c.restore(member, 'x.zip')],
    ['remove', (c: BackupController) => c.remove(member, 'x.zip')],
  ])('refuses %s for anyone else', (_name, call) => {
    const { controller, backups } = makeController();
    expect(() => call(controller)).toThrow(ForbiddenException);
    expect(backups.restore).not.toHaveBeenCalled();
    expect(backups.remove).not.toHaveBeenCalled();
  });
});
