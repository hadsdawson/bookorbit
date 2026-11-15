import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { AddAuthorNameResult, AuthorNameKind, AuthorNames } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { normalizePersonName, normalizePersonNameKey } from '../../common/utils/person-name.utils';
import { LibraryService } from '../library/library.service';
import { AuthorAliasesRepository } from './author-aliases.repository';
import { AuthorsRepository } from './authors.repository';
import { AuthorsService } from './authors.service';

/**
 * Fork: the other names an author goes by.
 *
 * - A spelling is folded into the author: a book credited to it is credited to the author instead
 *   (MetadataService.replaceAuthors), and an existing author under it is merged in.
 * - A pen name stays an author of its own, so books keep the name printed on them, and is tied to
 *   the person who wrote under it. One pen name can belong to several people (a shared pen name);
 *   a pen name never has pen names of its own.
 * - A main name is the other side of a pen name: the author whose page this is becomes a pen name
 *   of the name typed in.
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

  async names(user: RequestUser, authorId: number): Promise<AuthorNames> {
    const libraryIds = await this.libraryIds(user);
    await this.assertVisible(authorId, libraryIds);
    return this.collect(authorId, libraryIds);
  }

  async addName(user: RequestUser, authorId: number, rawName: string, kind: AuthorNameKind): Promise<AddAuthorNameResult> {
    const name = normalizePersonName(rawName);
    const nameKey = normalizePersonNameKey(name);
    if (!name || !nameKey) throw new BadRequestException('Name cannot be empty');
    const libraryIds = await this.libraryIds(user);
    await this.assertMutable(user, authorId, libraryIds);

    const event = 'author.add_name';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] authorId=${authorId} userId=${user.id} kind=${kind} - adding another name`);
    try {
      const owners = await this.aliasesRepo.findAuthorIdsByNameKey(nameKey);
      if (owners.some((owner) => owner.id === authorId)) throw new BadRequestException("That is already this author's name");
      const spelling = await this.aliasesRepo.findByKey(nameKey);
      if (spelling && (kind !== 'spelling' || spelling.authorId !== authorId)) {
        throw new ConflictException(`That name is already another spelling of ${spelling.authorName}`);
      }

      let mergedAuthorCount = 0;
      let affectedBookCount = 0;
      let openAuthorId: number | null = null;

      if (kind === 'spelling') {
        if (owners.length > 0) {
          if (!user.isSuperuser) {
            throw new ForbiddenException('An author with that name exists, and only superusers can combine authors');
          }
          const merged = await this.authorsService.merge(user, { targetAuthorId: authorId, sourceAuthorIds: owners.map((owner) => owner.id) });
          mergedAuthorCount = merged.mergedAuthorIds.length;
          affectedBookCount = merged.affectedBookCount;
        }
        await this.aliasesRepo.add(authorId, name, nameKey);
      } else if (kind === 'penName') {
        if (await this.aliasesRepo.isPenName(authorId)) {
          throw new BadRequestException('This is a pen name; add pen names on the page of the person who wrote under it');
        }
        const penName = owners[0] ?? (await this.aliasesRepo.createAuthor(name));
        if (await this.aliasesRepo.hasPenNames(penName.id)) {
          throw new BadRequestException(`${penName.name} has pen names of their own, so it cannot be a pen name`);
        }
        await this.aliasesRepo.linkPenName(penName.id, authorId);
      } else {
        if (await this.aliasesRepo.hasPenNames(authorId)) {
          throw new BadRequestException('This author has pen names, so it cannot become a pen name of someone else');
        }
        const main = owners[0] ?? (await this.aliasesRepo.createAuthor(name));
        if (await this.aliasesRepo.isPenName(main.id)) {
          throw new BadRequestException(`${main.name} is itself a pen name`);
        }
        await this.aliasesRepo.linkPenName(authorId, main.id);
        openAuthorId = main.id;
      }

      this.logger.log(
        `[${event}] [end] authorId=${authorId} kind=${kind} durationMs=${Date.now() - startedAt} mergedAuthors=${mergedAuthorCount} affectedBooks=${affectedBookCount} - name added`,
      );
      return { names: await this.collect(authorId, libraryIds), mergedAuthorCount, affectedBookCount, openAuthorId };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const message = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] authorId=${authorId} kind=${kind} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - adding a name failed`,
      );
      throw err;
    }
  }

  async removeSpelling(user: RequestUser, authorId: number, aliasId: number): Promise<AuthorNames> {
    const libraryIds = await this.libraryIds(user);
    await this.assertMutable(user, authorId, libraryIds);
    if (!(await this.aliasesRepo.remove(authorId, aliasId))) throw new NotFoundException('Alternate name not found');
    return this.collect(authorId, libraryIds);
  }

  /** Unties a pen name from a person, from either side; both stay authors with their own books. */
  async unlinkPenName(user: RequestUser, authorId: number, otherAuthorId: number): Promise<AuthorNames> {
    const libraryIds = await this.libraryIds(user);
    await this.assertMutable(user, authorId, libraryIds);
    const removed =
      (await this.aliasesRepo.unlinkPenName(otherAuthorId, authorId)) || (await this.aliasesRepo.unlinkPenName(authorId, otherAuthorId));
    if (!removed) throw new NotFoundException('Pen name not found');
    this.logger.log(`[author.unlink_pen_name] [end] authorId=${authorId} otherAuthorId=${otherAuthorId} userId=${user.id} - pen name untied`);
    return this.collect(authorId, libraryIds);
  }

  private async collect(authorId: number, libraryIds: number[]): Promise<AuthorNames> {
    const [spellings, penNames, penNameOf] = await Promise.all([
      this.aliasesRepo.listForAuthor(authorId),
      this.aliasesRepo.listPenNames(authorId, libraryIds),
      this.aliasesRepo.listPenNameOf(authorId, libraryIds),
    ]);
    return { spellings, penNames, penNameOf };
  }

  private async libraryIds(user: RequestUser): Promise<number[]> {
    const libraries = await this.libraryService.findAll(user);
    return libraries.map((library) => library.id);
  }

  private async assertVisible(authorId: number, libraryIds: number[]): Promise<void> {
    const visible = await this.authorsRepo.findVisibleAuthorIds([authorId], libraryIds);
    if (visible.length === 0) throw new NotFoundException('Author not found');
  }

  private async assertMutable(user: RequestUser, authorId: number, libraryIds: number[]): Promise<void> {
    await this.assertVisible(authorId, libraryIds);
    const editable = new Set(await this.libraryService.findEditableLibraryIds(user));
    const related = await this.authorsRepo.findRelatedLibraryIds([authorId]);
    if (related.some((libraryId) => !editable.has(libraryId))) {
      throw new ForbiddenException('Insufficient library access to edit this author');
    }
  }
}
