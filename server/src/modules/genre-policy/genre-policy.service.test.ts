import { GENRE_POLICY_SETTING_KEYS } from '@bookorbit/types';

import { GenrePolicyService } from './genre-policy.service';

const KEYS = GENRE_POLICY_SETTING_KEYS;

function makeService(stored: Record<string, string> = {}) {
  const values = new Map(Object.entries(stored));
  const appSettings = {
    getValues: vi.fn(async (keys: string[]) => new Map(keys.filter((key) => values.has(key)).map((key) => [key, values.get(key)!]))),
    setValue: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
  };
  return { service: new GenrePolicyService(appSettings as never), appSettings };
}

describe('GenrePolicyService', () => {
  it('is off with an empty list by default', async () => {
    await expect(makeService().service.get()).resolves.toEqual({ enabled: false, genres: [] });
  });

  it('passes every genre through while off', async () => {
    const { service } = makeService({ [KEYS.GENRES]: JSON.stringify(['Fantasy']) });
    await expect(service.filter(['Horror', 'Fantasy'])).resolves.toEqual(['Horror', 'Fantasy']);
  });

  it('keeps only allowed genres, in their allowed spelling, while on', async () => {
    const { service } = makeService({ [KEYS.ENABLED]: 'true', [KEYS.GENRES]: JSON.stringify(['Science Fiction', 'Fantasy']) });
    await expect(service.filter(['fantasy', 'Horror', 'SCIENCE FICTION', 'Fantasy'])).resolves.toEqual(['Fantasy', 'Science Fiction']);
  });

  it('stores a cleaned list and serves the new one straight away', async () => {
    const { service, appSettings } = makeService();
    await service.get();
    const policy = await service.update({ enabled: true, genres: [' Fantasy ', 'fantasy', '', 'Romance'] });
    expect(appSettings.setValue).toHaveBeenCalledWith(KEYS.GENRES, JSON.stringify(['Fantasy', 'Romance']));
    expect(policy).toEqual({ enabled: true, genres: ['Fantasy', 'Romance'] });
  });

  it('treats a damaged stored list as empty', async () => {
    const { service } = makeService({ [KEYS.GENRES]: '{not json' });
    await expect(service.get()).resolves.toEqual({ enabled: false, genres: [] });
  });
});
