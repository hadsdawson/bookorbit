import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BOOK_REQUEST_SAVED_VIEW_LIMIT } from '@bookorbit/types';
import type { BookRequestSavedView, BookRequestSavedViewFilters } from '@bookorbit/types';

import { BookRequestSavedViewRepository, type BookRequestSavedViewRow } from './book-request-saved-view.repository';

function toView(row: BookRequestSavedViewRow): BookRequestSavedView {
  return { id: row.id, name: row.name, filters: row.filters };
}

/** Only the fields that were set are kept, so a saved view never carries empty keys. */
function compact(filters: BookRequestSavedViewFilters): BookRequestSavedViewFilters {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  ) as BookRequestSavedViewFilters;
}

@Injectable()
export class BookRequestSavedViewService {
  constructor(private readonly repo: BookRequestSavedViewRepository) {}

  async list(userId: number): Promise<BookRequestSavedView[]> {
    return (await this.repo.list(userId)).map(toView);
  }

  async save(userId: number, name: string, filters: BookRequestSavedViewFilters): Promise<BookRequestSavedView> {
    if (!(await this.repo.exists(userId, name)) && (await this.repo.count(userId)) >= BOOK_REQUEST_SAVED_VIEW_LIMIT) {
      throw new BadRequestException(`You can keep at most ${BOOK_REQUEST_SAVED_VIEW_LIMIT} saved views`);
    }
    return toView(await this.repo.upsert(userId, name, compact(filters)));
  }

  async remove(userId: number, id: number): Promise<void> {
    if (!(await this.repo.remove(userId, id))) throw new NotFoundException('Saved view not found');
  }
}
