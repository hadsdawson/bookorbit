import { ForbiddenException } from '@nestjs/common';

import { ChapterAutoApplySettingsService, parseTolerance, RUNTIME_TOLERANCE_KEY } from './chapter-auto-apply-settings.service';

function makeService(stored: string | null = null) {
  const values = new Map<string, string>(stored === null ? [] : [[RUNTIME_TOLERANCE_KEY, stored]]);
  const appSettings = {
    getValue: vi.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    setValue: vi.fn((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    }),
  };
  return { service: new ChapterAutoApplySettingsService(appSettings as never), values };
}

const admin = { id: 1, isSuperuser: false, permissions: ['manage_app_settings'] } as never;
const editor = { id: 2, isSuperuser: false, permissions: ['library_edit_metadata'] } as never;

describe('ChapterAutoApplySettingsService', () => {
  it('defaults to 2 seconds', async () => {
    const { service } = makeService();
    await expect(service.runtimeToleranceMs()).resolves.toBe(2_000);
  });

  it('lets someone with App settings change it, and says who may', async () => {
    const { service, values } = makeService();
    await expect(service.update(admin, 7.5)).resolves.toEqual({ runtimeToleranceSeconds: 7.5, canEdit: true });
    expect(values.get(RUNTIME_TOLERANCE_KEY)).toBe('7.5');
    await expect(service.get(editor)).resolves.toEqual({ runtimeToleranceSeconds: 7.5, canEdit: false });
    await expect(service.runtimeToleranceMs()).resolves.toBe(7_500);
  });

  it('refuses anyone without App settings', async () => {
    const { service, values } = makeService();
    await expect(service.update(editor, 10)).rejects.toBeInstanceOf(ForbiddenException);
    expect(values.has(RUNTIME_TOLERANCE_KEY)).toBe(false);
  });

  it('keeps stored values in range', () => {
    expect(parseTolerance('abc')).toBe(2);
    expect(parseTolerance('-4')).toBe(0);
    expect(parseTolerance('500')).toBe(60);
    expect(parseTolerance('3.14')).toBe(3.1);
  });
});
