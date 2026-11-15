import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { AuthorAlias, AuthorAliasesResult } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { normalizePersonName, normalizePersonNameKey } from '../../common/utils/person-name.utils';
import { LibraryService } from '../library/library.service';
import { AuthorAliasesRepository } from './author-aliases.repository';
import { AuthorsRepository } from './authors.repository';
import { AuthorsService } from './authors.service';

/**
 * Fork: alternate names for an author. A book credited to an alternate name is credited to the
 * author instead (MetadataService.replaceAuthors). Adding a name that already belongs to another
 * author folds that author in, through the usual merge.
 */
@Injectable()
export class AuthorAliasesService {
  private readonly logger = new Logger(AuthorAliasesService.name);

  constructor(
    private readonly aliasesRepo: AuthorAliasesRepository,
    private readonly authorsRepo: AuthorsRepository,
    private readonly authorsService: AuthorsService,
    private readonly libraryService: LibraryService,
  ) {}

  async list(user: RequestUser, authorId: number): Promise<AuthorAlias[]> {
    await this.assertVisible(user, authorId);
    return this.aliasesRepo.listForAuthor(authorId);
  }

  async add(user: RequestUser, authorId: number, rawName: string): Promise<AuthorAliasesResult> {
    const name = normalizePersonName(rawName);
    const nameKey = normalizePersonNameKey(name);
    if (!name || !nameKey) throw new BadRequestException('Name cannot be empty');
    await this.assertMutable(user, authorId);

    const event = 'author.add_alias';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] authorId=${authorId} userId=${user.id} - adding alternate name`);
    try {
      const owners = await this.aliasesRepo.findAuthorIdsByNameKey(nameKey);
      if (owners.some((owner) => owner.id === authorId)) throw new BadRequestException("That is already this author's name");

      const existing = await this.aliasesRepo.findByKey(nameKey);
      if (existing && existing.authorId !== authorId) {
        throw new ConflictException(`That name is already an alternate name of ${existing.authorName}`);
      }

      let mergedAuthorCount = 0;
      let affectedBookCount = 0;
      if (owners.length > 0) {
        if (!user.isSuperuser) {
          throw new ForbiddenException('An author with that name exists, and only superusers can combine authors');
        }
        const merged = await this.authorsService.merge(user, { targetAuthorId: authorId, sourceAuthorIds: owners.map((owner) => owner.id) });
        mergedAuthorCount = merged.mergedAuthorIds.length;
        affectedBookCount = merged.affectedBookCount;
      }
      await this.aliasesRepo.add(authorId, name, nameKey);

      this.logger.log(
        `[${event}] [end] authorId=${authorId} durationMs=${Date.now() - startedAt} mergedAuthors=${mergedAuthorCount} affectedBooks=${affectedBookCount} - alternate name added`,
      );
      return { aliases: await this.aliasesRepo.listForAuthor(authorId), mergedAuthorCount, affectedBookCount };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const message = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] authorId=${authorId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - adding alternate name failed`,
      );
      throw err;
    }
  }

  async remove(user: RequestUser, authorId: number, aliasId: number): Promise<AuthorAlias[]> {
    await this.assertMutable(user, authorId);
    if (!(await this.aliasesRepo.remove(authorId, aliasId))) throw new NotFoundException('Alternate name not found');
    return this.aliasesRepo.listForAuthor(authorId);
  }

  private async libraryIds(user: RequestUser): Promise<number[]> {
    const libraries = await this.libraryService.findAll(user);
    return libraries.map((library) => library.id);
  }

  private async assertVisible(user: RequestUser, authorId: number): Promise<void> {
    const visible = await this.authorsRepo.findVisibleAuthorIds([authorId], await this.libraryIds(user));
    if (visible.length === 0) throw new NotFoundException('Author not found');
  }

  private async assertMutable(user: RequestUser, authorId: number): Promise<void> {
    await this.assertVisible(user, authorId);
    const editable = new Set(await this.libraryService.findEditableLibraryIds(user));
    const related = await this.authorsRepo.findRelatedLibraryIds([authorId]);
    if (related.some((libraryId) => !editable.has(libraryId))) {
      throw new ForbiddenException('Insufficient library access to edit this author');
    }
  }
}
