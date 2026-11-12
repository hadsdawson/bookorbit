import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { join } from 'path';

import { isAudioFormat, type BookDockMetadata, type ComicMetadataFields } from '@bookorbit/types';
import type { ParsedBookData } from '../metadata/extractors/format-extractor.interface';
import { generateThumbnail, imageExt } from '../metadata/lib/cover';
import { MetadataExtractionService } from '../metadata/metadata-extraction.service';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { ABS_METADATA_MAX_BYTES, isAbsMetadataFile, parseAbsMetadataJson, pickAbsCoverFile } from './abs-metadata-import';
import { BookDockRepository } from './book-dock.repository';

/** What an Audiobookshelf folder brought: its metadata.json details and its own cover image. */
interface AbsFolderData {
  metadata: BookDockMetadata;
  cover: Buffer | null;
}

@Injectable()
export class BookDockMetadataService {
  private readonly logger = new Logger(BookDockMetadataService.name);

  constructor(
    private readonly repo: BookDockRepository,
    private readonly extractionService: MetadataExtractionService,
  ) {}

  /**
   * Reads the file's own details and cover. When its folder holds an Audiobookshelf metadata.json,
   * that file's details win field by field and become the row's chosen details, and the folder's
   * cover image is used ahead of embedded art. `fromAudiobookshelf` says whether that happened.
   */
  async extractAndSave(fileId: number, absolutePath: string, format: string, coversDir: string): Promise<{ fromAudiobookshelf: boolean }> {
    const startedAt = Date.now();
    await this.repo.update(fileId, { status: 'extracting' });
    try {
      const extracted = await this.extractionService.extractWithCoverFallback(absolutePath, format);
      const embedded = this.toBookDockMetadata(extracted.metadata);
      const abs = await this.readAbsFolderData(fileId, format);
      const metadata = abs ? { ...withoutUndefined(embedded), ...abs.metadata } : embedded;
      const coverBytes = abs?.cover ?? extracted.cover;

      let coverPath: string | null = null;
      if (coverBytes && coverBytes.length > 0) {
        coverPath = await this.saveCover(fileId, coverBytes, coversDir);
      }

      // A person's own edits in the Book Dock are never replaced when a file is read again.
      const keepEdits = abs ? (await this.repo.findById(fileId))?.metadataEditedAt != null : true;
      await this.repo.update(fileId, {
        embeddedMetadata: metadata,
        ...(abs && !keepEdits ? { selectedMetadata: metadata } : {}),
        coverPath,
        status: 'ready',
      });
      return { fromAudiobookshelf: abs !== null };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[book_dock.extract_metadata] [fail] fileId=${fileId} format=${format} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - metadata extraction failed`,
      );
      await this.repo.update(fileId, {
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Metadata extraction failed',
      });
      return { fromAudiobookshelf: false };
    }
  }

  private async readAbsFolderData(fileId: number, format: string): Promise<AbsFolderData | null> {
    const unitFiles = await this.repo.findUnitFiles(fileId);
    const metadataFile = unitFiles.find((file) => file.role === 'metadata' && isAbsMetadataFile(file.fileName));
    if (!metadataFile) return null;

    const startedAt = Date.now();
    const path = sanitizeLogValue(metadataFile.absolutePath);
    try {
      if ((await stat(metadataFile.absolutePath)).size > ABS_METADATA_MAX_BYTES) {
        this.logger.warn(
          `[book_dock.abs_metadata] [fail] fileId=${fileId} path="${path}" durationMs=${Date.now() - startedAt} errorClass=TooLarge error="file too large" - metadata.json skipped`,
        );
        return null;
      }
      const metadata = parseAbsMetadataJson(await readFile(metadataFile.absolutePath, 'utf8'), { audio: isAudioFormat(format) });
      if (!metadata) {
        this.logger.warn(
          `[book_dock.abs_metadata] [fail] fileId=${fileId} path="${path}" durationMs=${Date.now() - startedAt} errorClass=InvalidJson error="not a JSON object" - metadata.json skipped`,
        );
        return null;
      }
      const coverFile = pickAbsCoverFile(unitFiles.filter((file) => file.role === 'cover'));
      const cover = coverFile ? await readFile(coverFile.absolutePath).catch(() => null) : null;
      this.logger.log(
        `[book_dock.abs_metadata] [end] fileId=${fileId} path="${path}" durationMs=${Date.now() - startedAt} fields=${Object.keys(metadata).length} cover=${cover !== null} - Audiobookshelf details read`,
      );
      return { metadata, cover };
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[book_dock.abs_metadata] [fail] fileId=${fileId} path="${path}" durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - metadata.json unreadable`,
      );
      return null;
    }
  }

  private async saveCover(fileId: number, bytes: Buffer, coversDir: string): Promise<string> {
    await mkdir(coversDir, { recursive: true });

    const ext = imageExt(bytes);
    const coverPath = join(coversDir, `${fileId}.${ext}`);
    const thumbPath = join(coversDir, `${fileId}_thumb.jpg`);

    const thumbnail = await generateThumbnail(bytes);
    await Promise.all([writeFile(coverPath, bytes), writeFile(thumbPath, thumbnail)]);

    return coverPath;
  }

  private toBookDockMetadata(data: ParsedBookData | null): BookDockMetadata {
    if (!data) return {};
    return {
      title: data.title ?? undefined,
      subtitle: data.subtitle ?? undefined,
      description: data.description ?? undefined,
      publisher: data.publisher ?? undefined,
      publishedDate: data.publishedDate ?? undefined,
      publishedYear: data.publishedYear ?? undefined,
      language: data.language ?? undefined,
      isbn10: data.isbn10 ?? undefined,
      isbn13: data.isbn13 ?? undefined,
      seriesName: data.seriesName ?? undefined,
      seriesIndex: data.seriesIndex ?? undefined,
      pageCount: data.pageCount ?? undefined,
      authors: data.authors.length > 0 ? data.authors.map((a) => a.name) : undefined,
      genres: data.genres.length > 0 ? data.genres : undefined,
      narrators: data.narrators?.length ? data.narrators : undefined,
      durationSeconds: data.durationSeconds ?? undefined,
      chapters: data.chapters?.length ? data.chapters : undefined,
      ...providerIdMetadata(data),
      ...(data.comicMetadata ? { comicMetadata: normalizeBookDockComicMetadata(data.comicMetadata) } : {}),
    };
  }
}

type ProviderIdMetadata = Partial<
  Record<
    | 'googleBooksId'
    | 'goodreadsId'
    | 'amazonId'
    | 'hardcoverId'
    | 'hardcoverEditionId'
    | 'openLibraryId'
    | 'itunesId'
    | 'audibleId'
    | 'librofmId'
    | 'koboId'
    | 'comicvineId'
    | 'ranobedbId'
    | 'lubimyczytacId'
    | 'aladinId',
    string | null
  >
>;

function providerIdMetadata(data: ProviderIdMetadata): Partial<BookDockMetadata> {
  const metadata: Partial<BookDockMetadata> = {};
  const fields = [
    'googleBooksId',
    'goodreadsId',
    'amazonId',
    'hardcoverId',
    'hardcoverEditionId',
    'openLibraryId',
    'itunesId',
    'audibleId',
    'librofmId',
    'koboId',
    'comicvineId',
    'ranobedbId',
    'lubimyczytacId',
    'aladinId',
  ] as const;
  for (const field of fields) {
    const value = data[field];
    if (value) metadata[field] = value;
  }
  return metadata;
}

function normalizeBookDockComicMetadata(
  value: Partial<Record<keyof ComicMetadataFields, string | string[] | null | undefined>>,
): ComicMetadataFields {
  const metadata: ComicMetadataFields = {};
  if (value.issueNumber) metadata.issueNumber = value.issueNumber as string;
  if (value.volumeName) metadata.volumeName = value.volumeName as string;

  const arrayFields = ['pencillers', 'inkers', 'colorists', 'letterers', 'coverArtists', 'characters', 'teams', 'locations', 'storyArcs'] as const;
  for (const field of arrayFields) {
    const entries = value[field];
    if (Array.isArray(entries) && entries.length > 0) metadata[field] = entries;
  }
  return metadata;
}

function withoutUndefined(metadata: BookDockMetadata): BookDockMetadata {
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)) as BookDockMetadata;
}
