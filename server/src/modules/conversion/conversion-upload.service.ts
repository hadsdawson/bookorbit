import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, readdir, rename, rm, stat } from 'fs/promises';
import { dirname, extname, isAbsolute, join, normalize, sep } from 'path';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { CONVERSION_UPLOAD_DIR, ConversionService } from './conversion.service';
import { isHidden } from './lib/conversion-unit';

const MAX_DEPTH = 6;
const COLLISION_ATTEMPTS_MAX = 1_000;
const BATCH_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Uploads from the browser into the Convert folder. Files land in a hidden staging folder per
 * upload and are moved in together once the upload finishes, so a folder of tracks is never
 * converted half-uploaded.
 */
@Injectable()
export class ConversionUploadService {
  private readonly logger = new Logger(ConversionUploadService.name);
  private readonly convertRoot: string;

  constructor(
    config: ConfigService,
    private readonly conversions: ConversionService,
  ) {
    const appDataPath = config.get<string>('storage.appDataPath') ?? '/data';
    this.convertRoot = config.get<string>('storage.convertPath') ?? join(appDataPath, 'convert');
  }

  private get stagingRoot(): string {
    return join(this.convertRoot, CONVERSION_UPLOAD_DIR);
  }

  async start(): Promise<{ batchId: string }> {
    await this.assertEnabled();
    const batchId = randomUUID();
    await mkdir(join(this.stagingRoot, batchId), { recursive: true });
    return { batchId };
  }

  async receive(batchId: string, relativePath: string, file: Readable, limitBytes: number): Promise<void> {
    await this.assertEnabled();
    const batchDir = await this.batchDir(batchId);
    const relPath = safeUploadPath(relativePath);
    const target = join(batchDir, relPath);
    await mkdir(dirname(target), { recursive: true });
    await pipeline(file, createWriteStream(target, { flags: 'wx' })).catch(async (err: unknown) => {
      await rm(target, { force: true });
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new ConflictException('That file is already in this upload');
      throw err;
    });
    if ((file as Readable & { truncated?: boolean }).truncated) {
      await rm(target, { force: true });
      throw new PayloadTooLargeException(`File exceeds the ${Math.floor(limitBytes / 1_048_576)} MB upload limit`);
    }
  }

  /** Moves everything uploaded in this batch into the Convert folder, where conversion picks it up. */
  async finish(batchId: string): Promise<{ items: number }> {
    const startedAt = Date.now();
    const batchDir = await this.batchDir(batchId);
    const names = (await readdir(batchDir)).filter((name) => !isHidden(name));
    for (const name of names) {
      const source = join(batchDir, name);
      const isDirectory = await stat(source).then(
        (info) => info.isDirectory(),
        () => false,
      );
      await rename(source, await freeName(join(this.convertRoot, name), isDirectory));
    }
    await rm(batchDir, { recursive: true, force: true });
    this.logger.log(
      `[conversion.upload] [end] batchId=${batchId} durationMs=${Date.now() - startedAt} items=${names.length} - upload moved into the Convert folder`,
    );
    return { items: names.length };
  }

  async cancel(batchId: string): Promise<void> {
    if (!BATCH_ID_RE.test(batchId)) throw new NotFoundException('There is no upload with that id');
    await rm(join(this.stagingRoot, batchId), { recursive: true, force: true });
    this.logger.log(`[conversion.upload] [end] batchId=${sanitizeLogValue(batchId)} cancelled=true - upload discarded`);
  }

  private async assertEnabled(): Promise<void> {
    if (!(await this.conversions.isEnabled())) throw new ConflictException('Conversions are turned off');
  }

  private async batchDir(batchId: string): Promise<string> {
    const dir = join(this.stagingRoot, batchId);
    const exists =
      BATCH_ID_RE.test(batchId) &&
      (await stat(dir).then(
        (info) => info.isDirectory(),
        () => false,
      ));
    if (!exists) throw new NotFoundException('There is no upload with that id');
    return dir;
  }
}

/** A browser's relative path for a file, kept inside the upload: no absolute paths, `..` or hidden parts. */
export function safeUploadPath(relativePath: string): string {
  const cleaned = relativePath.replace(/\\/g, '/').trim();
  if (!cleaned || cleaned.includes('\0') || isAbsolute(cleaned)) throw new BadRequestException('Invalid file path');
  const parts = normalize(cleaned).split(sep).filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_DEPTH) throw new BadRequestException('Invalid file path');
  if (parts.some((part) => part === '..' || part === '.' || isHidden(part))) throw new BadRequestException('Invalid file path');
  return parts.join(sep);
}

/** "Book.mp3" becomes "Book (2).mp3", keeping the extension conversion looks at; a folder gets the number at the end. */
async function freeName(target: string, isDirectory: boolean): Promise<string> {
  const exists = (path: string) =>
    stat(path).then(
      () => true,
      () => false,
    );
  if (!(await exists(target))) return target;
  const extension = isDirectory ? '' : extname(target);
  const stem = target.slice(0, target.length - extension.length);
  for (let attempt = 2; attempt <= COLLISION_ATTEMPTS_MAX; attempt += 1) {
    const candidate = `${stem} (${attempt})${extension}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new ConflictException('The Convert folder already holds too many items with this name');
}
