import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { AuthorLink } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { LibraryService } from '../library/library.service';
import { AuthorLinksRepository } from './author-links.repository';
import { AuthorsRepository } from './authors.repository';

/** Fork: link author names that are one person, so a book credited to one is credited to all. */
@Injectable()
export class AuthorLinksService {
  private readonly logger = new Logger(AuthorLinksService.name);

  constructor(
    private readonly linksRepo: AuthorLinksRepository,
    private readonly authorsRepo: AuthorsRepository,
    private readonly libraryService: LibraryService,
  ) {}

  async list(user: RequestUser, authorId: number): Promise<AuthorLink[]> {
    const libraryIds = await this.libraryIds(user);
    await this.assertVisible([authorId], libraryIds);
    return this.visibleLinks(authorId, libraryIds);
  }

  async link(user: RequestUser, authorId: number, otherId: number): Promise<AuthorLink[]> {
    if (authorId === otherId) throw new BadRequestException('An author cannot be linked to itself');
    await this.assertMutable(user, [authorId, otherId]);

    const event = 'author.link';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] authorId=${authorId} linkedAuthorId=${otherId} userId=${user.id} - linking authors`);
    try {
      const members = await this.linksRepo.link(authorId, otherId);
      const creditedBookIds = await this.linksRepo.creditGroupOnBooks(members);
      this.logger.log(
        `[${event}] [end] authorId=${authorId} linkedAuthorId=${otherId} durationMs=${Date.now() - startedAt} groupSize=${members.length} booksCredited=${creditedBookIds.length} - authors linked`,
      );
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const message = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.error(
        `[${event}] [fail] authorId=${authorId} linkedAuthorId=${otherId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - linking authors failed`,
      );
      throw err;
    }
    return this.visibleLinks(authorId, await this.libraryIds(user));
  }

  async unlink(user: RequestUser, authorId: number, linkedId: number): Promise<AuthorLink[]> {
    await this.assertMutable(user, [authorId, linkedId]);
    if (!(await this.linksRepo.unlink(authorId, linkedId))) throw new NotFoundException('Authors are not linked');
    return this.visibleLinks(authorId, await this.libraryIds(user));
  }

  private async visibleLinks(authorId: number, libraryIds: number[]): Promise<AuthorLink[]> {
    const linked = await this.linksRepo.findLinkedAuthors(authorId);
    if (linked.length === 0) return [];
    const visible = new Set(
      await this.authorsRepo.findVisibleAuthorIds(
        linked.map((author) => author.id),
        libraryIds,
      ),
    );
    return linked.filter((author) => visible.has(author.id));
  }

  private async libraryIds(user: RequestUser): Promise<number[]> {
    const libraries = await this.libraryService.findAll(user);
    return libraries.map((library) => library.id);
  }

  private async assertVisible(authorIds: number[], libraryIds: number[]): Promise<void> {
    const visible = await this.authorsRepo.findVisibleAuthorIds(authorIds, libraryIds);
    if (visible.length !== new Set(authorIds).size) throw new NotFoundException('Author not found');
  }

  private async assertMutable(user: RequestUser, authorIds: number[]): Promise<void> {
    const [libraryIds, editableLibraryIds] = await Promise.all([this.libraryIds(user), this.libraryService.findEditableLibraryIds(user)]);
    await this.assertVisible(authorIds, libraryIds);
    const editable = new Set(editableLibraryIds);
    const related = await this.authorsRepo.findRelatedLibraryIds(authorIds);
    if (related.some((libraryId) => !editable.has(libraryId))) {
      throw new ForbiddenException('Insufficient library access to link these authors');
    }
  }
}
