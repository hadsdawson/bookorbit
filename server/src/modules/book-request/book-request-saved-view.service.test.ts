import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BOOK_REQUEST_SAVED_VIEW_LIMIT } from '@bookorbit/types';
import { describe, expect, it, vi } from 'vitest';

import { BookRequestSavedViewService } from './book-request-saved-view.service';
import type { BookRequestSavedViewRepository, BookRequestSavedViewRow } from './book-request-saved-view.repository';

function row(overrides: Partial<BookRequestSavedViewRow> = {}): BookRequestSavedViewRow {
  return {
    id: 1,
    userId: 7,
    name: 'Audio to chase',
    filters: { format: 'audiobook' },
    createdAt: new Date('2026-11-20T12:00:00Z'),
    updatedAt: new Date('2026-11-20T12:00:00Z'),
    ...overrides,
  };
}

function make(repo: Partial<Record<keyof BookRequestSavedViewRepository, unknown>> = {}) {
  const full = {
    list: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    exists: vi.fn().mockResolvedValue(false),
    upsert: vi.fn().mockImplementation((_user: number, name: string, filters: unknown) => Promise.resolve(row({ name, filters: filters as never }))),
    remove: vi.fn().mockResolvedValue(true),
    ...repo,
  };
  return { service: new BookRequestSavedViewService(full as unknown as BookRequestSavedViewRepository), repo: full };
}

describe('BookRequestSavedViewService', () => {
  it('lists only what the repository returns for that user', async () => {
    const { service, repo } = make({ list: vi.fn().mockResolvedValue([row()]) });
    expect(await service.list(7)).toEqual([{ id: 1, name: 'Audio to chase', filters: { format: 'audiobook' } }]);
    expect(repo.list).toHaveBeenCalledWith(7);
  });

  it('saves a view without empty filter keys', async () => {
    const { service, repo } = make();
    await service.save(7, 'Mine', { status: undefined, format: 'ebook', sort: 'title' });
    expect(repo.upsert).toHaveBeenCalledWith(7, 'Mine', { format: 'ebook', sort: 'title' });
  });

  it('refuses a new view past the limit, but still lets an existing one be replaced', async () => {
    const full = make({ count: vi.fn().mockResolvedValue(BOOK_REQUEST_SAVED_VIEW_LIMIT) });
    await expect(full.service.save(7, 'One more', {})).rejects.toBeInstanceOf(BadRequestException);

    const replacing = make({ count: vi.fn().mockResolvedValue(BOOK_REQUEST_SAVED_VIEW_LIMIT), exists: vi.fn().mockResolvedValue(true) });
    await expect(replacing.service.save(7, 'Existing', {})).resolves.toMatchObject({ name: 'Existing' });
  });

  it('only removes a view that belongs to the caller', async () => {
    const { service, repo } = make({ remove: vi.fn().mockResolvedValue(false) });
    await expect(service.remove(7, 99)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.remove).toHaveBeenCalledWith(7, 99);
  });
});
