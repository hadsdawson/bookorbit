import { Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { watch, type FSWatcher } from 'chokidar';
import { randomUUID } from 'crypto';
import { copyFile, cp, mkdir, readdir, realpath, rename, rm, writeFile } from 'fs/promises';
import { basename, dirname, extname, join, relative, sep } from 'path';
import {
  CONVERSION_CONCURRENCY_MAX,
  CONVERSION_CONCURRENCY_MIN,
  DEFAULT_CONVERSION_SETTINGS,
  type ConversionJob,
  type ConversionOverview,
  type ConversionReason,
  type ConversionSettings,
} from '@bookorbit/types';

import { isCrossDeviceError, pathExists, removeEmptyDirs } from '../../common/utils/file-move.utils';
import { waitForDirectoryStability, waitForStability } from '../../common/utils/fs-stability.utils';
import { waitForWatcherReady } from '../../common/utils/fs-watch.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { runFfmpeg } from '../file-write/formats/audio/ffmpeg-runner';
import { RecycleBinService } from '../recycle-bin/recycle-bin.service';
import {
  JOIN_TRACKS_MAX,
  buildConcatList,
  buildFfmetadata,
  buildFfmpegArgs,
  buildJoinArgs,
  planConversion,
  planJoin,
  probeAudio,
  sameLength,
  totalDurationMs,
  trackChapters,
  type AudioProbe,
  type ConversionPlan,
  type Track,
} from './lib/conversion-media';
import { isHidden, readUnit, type ConversionUnit } from './lib/conversion-unit';

export const CONVERSION_SETTINGS_KEY = 'conversion_settings';
/** Inside the Convert folder, so a finished M4B usually reaches the Book Dock with one rename. */
export const CONVERSION_WORK_DIR = '.bookorbit-converting';
/** Inside the Convert folder and hidden, so nothing is converted until a whole upload is in. */
export const CONVERSION_UPLOAD_DIR = '.bookorbit-uploading';
const RECYCLE_BIN_LABEL = 'Convert folder';
const DEBOUNCE_MS = 2_000;
const FINISHED_JOBS_KEPT = 100;
const COLLISION_ATTEMPTS_MAX = 1_000;

interface TrackedJob extends ConversionJob {
  sourcePath: string;
  /** The unit as it was when this job last looked at it; null means look again. */
  signature: string | null;
  abort: AbortController | null;
}

export function parseConversionSettings(raw: string | null | undefined): ConversionSettings {
  let value: Partial<ConversionSettings>;
  try {
    value = raw ? (JSON.parse(raw) as Partial<ConversionSettings>) : {};
  } catch {
    value = {};
  }
  const concurrency = value?.concurrency;
  return {
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : DEFAULT_CONVERSION_SETTINGS.enabled,
    concurrency:
      Number.isInteger(concurrency) && concurrency! >= CONVERSION_CONCURRENCY_MIN && concurrency! <= CONVERSION_CONCURRENCY_MAX
        ? concurrency!
        : DEFAULT_CONVERSION_SETTINGS.concurrency,
  };
}

/**
 * Converts audiobooks dropped in the Convert folder to M4B and hands each result to the Book Dock.
 *
 * Nothing runs while the feature is off: no folder watcher, no queue. Each conversion uses one
 * FFmpeg thread at the lowest priority, and the original only leaves the Convert folder once the
 * M4B has been checked and is in the Book Dock.
 */
@Injectable()
export class ConversionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ConversionService.name);
  private readonly convertRoot: string;
  private readonly bookDockRoot: string;
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private readonly jobs = new Map<string, TrackedJob>();
  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private settings: ConversionSettings = DEFAULT_CONVERSION_SETTINGS;
  private watcher: FSWatcher | null = null;
  private running = 0;
  private stopping = false;

  constructor(
    private readonly config: ConfigService,
    private readonly appSettings: AppSettingsService,
    private readonly recycleBin: RecycleBinService,
  ) {
    const appDataPath = this.config.get<string>('storage.appDataPath') ?? '/data';
    this.convertRoot = this.config.get<string>('storage.convertPath') ?? join(appDataPath, 'convert');
    this.bookDockRoot = this.config.get<string>('storage.bookDockPath') ?? join(appDataPath, 'book-dock');
    this.ffmpegPath = this.config.get<string>('audioTools.ffmpegPath') ?? 'ffmpeg';
    this.ffprobePath = this.config.get<string>('audioTools.ffprobePath') ?? 'ffprobe';
  }

  async onApplicationBootstrap(): Promise<void> {
    this.recycleBin.registerFolder({ path: this.convertRoot, libraryName: RECYCLE_BIN_LABEL });
    this.settings = await this.getSettings();
    if (this.settings.enabled) await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  async getSettings(): Promise<ConversionSettings> {
    return parseConversionSettings(await this.appSettings.getValue(CONVERSION_SETTINGS_KEY));
  }

  async updateSettings(next: ConversionSettings): Promise<ConversionSettings> {
    const settings = parseConversionSettings(JSON.stringify(next));
    await this.appSettings.setValue(CONVERSION_SETTINGS_KEY, JSON.stringify(settings));
    const wasEnabled = this.settings.enabled;
    this.settings = settings;
    this.logger.log(`[conversion.settings] [end] enabled=${settings.enabled} concurrency=${settings.concurrency} - conversion settings saved`);
    if (settings.enabled && !wasEnabled) await this.start();
    else if (!settings.enabled && wasEnabled) await this.stop();
    else this.pump();
    return settings;
  }

  async isEnabled(): Promise<boolean> {
    return (await this.getSettings()).enabled;
  }

  async overview(): Promise<ConversionOverview> {
    const jobs = [...this.jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)).map(toPublicJob);
    return { settings: await this.getSettings(), convertPath: this.convertRoot, jobs };
  }

  /** Looks at a failed item again, whether or not it changed. */
  retry(id: string): ConversionJob {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'failed') throw new NotFoundException('There is no failed conversion with that id');
    this.queue(job);
    const queued = toPublicJob(job);
    this.pump();
    return queued;
  }

  private async start(): Promise<void> {
    this.stopping = false;
    try {
      await mkdir(this.convertRoot, { recursive: true });
      await rm(join(this.convertRoot, CONVERSION_WORK_DIR), { recursive: true, force: true });
      // Uploads cut off by a restart or by turning conversions off are never finished.
      await rm(join(this.convertRoot, CONVERSION_UPLOAD_DIR), { recursive: true, force: true });
      this.watcher = watch(this.convertRoot, {
        ignoreInitial: true,
        followSymlinks: false,
        ignored: (path: string) => path !== this.convertRoot && relative(this.convertRoot, path).split(sep).some(isHidden),
      });
      this.watcher.on('all', (_event, path) => this.schedule(path));
      this.watcher.on('error', (err) => this.logFail('conversion.watch', Date.now(), err, '', 'Convert folder watcher error'));
      await waitForWatcherReady(this.watcher);
      this.logger.log(`[conversion.watch] [start] path="${sanitizeLogValue(this.convertRoot)}" - watching the Convert folder`);
      await this.rescan();
    } catch (err) {
      this.logFail('conversion.watch', Date.now(), err, `path="${sanitizeLogValue(this.convertRoot)}"`, 'could not watch the Convert folder');
    }
  }

  private async stop(): Promise<void> {
    this.stopping = true;
    for (const timer of this.pendingTimers.values()) clearTimeout(timer);
    this.pendingTimers.clear();
    for (const job of this.jobs.values()) job.abort?.abort();
    for (const [id, job] of this.jobs) {
      if (job.status === 'queued') this.jobs.delete(id);
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.logger.log(`[conversion.watch] [end] - stopped watching the Convert folder`);
    }
  }

  private async rescan(): Promise<void> {
    const entries = await readdir(this.convertRoot).catch(() => [] as string[]);
    for (const name of entries) {
      if (!isHidden(name)) await this.consider(join(this.convertRoot, name));
    }
  }

  /** A dropped folder fires an event per file, so events wait for the top-level item to go quiet. */
  private schedule(path: string): void {
    if (this.stopping) return;
    const top = this.topLevelPath(path);
    if (!top) return;
    const existing = this.pendingTimers.get(top);
    if (existing) clearTimeout(existing);
    this.pendingTimers.set(
      top,
      setTimeout(() => {
        this.pendingTimers.delete(top);
        this.consider(top).catch((err) =>
          this.logFail('conversion.inspect', Date.now(), err, `path="${sanitizeLogValue(top)}"`, 'could not look at a dropped item'),
        );
      }, DEBOUNCE_MS),
    );
  }

  private topLevelPath(path: string): string | null {
    const rel = relative(this.convertRoot, path);
    if (!rel || rel.startsWith('..')) return null;
    return join(this.convertRoot, rel.split(sep)[0]);
  }

  private async consider(path: string): Promise<void> {
    const existing = [...this.jobs.values()].find((job) => job.sourcePath === path);
    if (existing && (existing.status === 'queued' || existing.status === 'converting')) return;

    const unit = await readUnit(path);
    if (!unit) return;
    if (unit.isDirectory) await waitForDirectoryStability(path);
    else await waitForStability(path);
    if (this.stopping) return;

    const settled = await readUnit(path);
    if (!settled) return;
    const reusable = existing && existing.status !== 'done' ? existing : null;
    if (reusable && reusable.signature === settled.signature) return;

    const job = reusable ?? this.newJob(path);
    job.signature = settled.signature;
    this.queue(job);
    this.pump();
  }

  private newJob(sourcePath: string): TrackedJob {
    const job: TrackedJob = {
      id: randomUUID(),
      name: basename(sourcePath),
      sourcePath,
      status: 'queued',
      method: null,
      progress: null,
      bitrate: null,
      trackCount: null,
      reason: null,
      detail: null,
      outputName: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      signature: null,
      abort: null,
    };
    this.jobs.set(job.id, job);
    this.trimFinished();
    return job;
  }

  private queue(job: TrackedJob): void {
    Object.assign(job, { status: 'queued', progress: null, reason: null, detail: null, startedAt: null, finishedAt: null });
  }

  private pump(): void {
    if (this.stopping || !this.settings.enabled) return;
    while (this.running < this.settings.concurrency) {
      const next = [...this.jobs.values()].filter((job) => job.status === 'queued').sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
      if (!next) return;
      this.running += 1;
      next.status = 'converting';
      next.progress = 0;
      next.startedAt = new Date().toISOString();
      void this.run(next).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  private async run(job: TrackedJob): Promise<void> {
    const event = 'conversion.convert';
    const startedAt = Date.now();
    const unit = await readUnit(job.sourcePath);
    if (!unit) {
      this.jobs.delete(job.id);
      return;
    }
    job.signature = unit.signature;
    if (unit.audioFiles.length === 0) return this.finish(job, 'skipped', 'no_audio');
    if (unit.audioFiles.length > JOIN_TRACKS_MAX) return this.finish(job, 'waiting', 'too_many_files');

    const workDir = join(this.convertRoot, CONVERSION_WORK_DIR, job.id);
    this.logger.log(`[${event}] [start] jobId=${job.id} name="${sanitizeLogValue(job.name)}" - conversion started`);
    try {
      const outputDir = unit.isDirectory ? join(workDir, basename(unit.path)) : workDir;
      await mkdir(outputDir, { recursive: true });
      const { plan, output } =
        unit.audioFiles.length > 1 ? await this.join(job, unit, workDir, outputDir) : await this.convertOne(job, unit, outputDir);
      if (unit.isDirectory) await this.copyExtras(unit, outputDir);

      const landed = await this.handOff(unit.isDirectory ? outputDir : output);
      job.outputName = relative(this.bookDockRoot, landed);
      const removed = await this.removeOriginal(job, unit);
      this.logger.log(
        `[${event}] [end] jobId=${job.id} durationMs=${Date.now() - startedAt} method=${plan.method} bitrate=${plan.bitrate ?? 0} originalRemoved=${removed} - converted and moved to the Book Dock`,
      );
      this.finish(job, 'done', removed ? null : 'original_kept');
    } catch (err) {
      this.logFail(event, startedAt, err, `jobId=${job.id}`, 'conversion failed');
      const stopped = err instanceof Error && err.name === 'AbortError';
      this.finish(job, 'failed', stopped ? 'stopped' : 'failed', stopped ? null : failureDetail(err));
    } finally {
      job.abort = null;
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async convertOne(job: TrackedJob, unit: ConversionUnit, outputDir: string): Promise<{ plan: ConversionPlan; output: string }> {
    const source = unit.audioFiles[0];
    const probe = await probeAudio(this.ffprobePath, source);
    const plan = planConversion(source, probe);
    job.method = plan.method;
    job.bitrate = plan.bitrate;
    const outputFile = join(outputDir, `${basename(source, extname(source))}.m4b`);
    await this.convert(job, source, outputFile, plan, probe);
    await this.verify(outputFile, probe.durationMs);
    return { plan, output: outputFile };
  }

  /** A folder of tracks becomes one M4B with a chapter per track, named after the folder. */
  private async join(job: TrackedJob, unit: ConversionUnit, workDir: string, outputDir: string): Promise<{ plan: ConversionPlan; output: string }> {
    const tracks: Track[] = [];
    for (const path of unit.audioFiles) tracks.push({ path, probe: await probeAudio(this.ffprobePath, path) });
    const plan = planJoin(tracks);
    job.method = plan.method;
    job.bitrate = plan.bitrate;
    job.trackCount = tracks.length;

    const first = tracks[0].probe.tags;
    const bookTitle = first.album ?? basename(unit.path);
    const metadataFile = join(workDir, 'metadata.txt');
    const concatList = join(workDir, 'tracks.txt');
    await writeFile(metadataFile, buildFfmetadata({ title: bookTitle, album: bookTitle, artist: first.artist }, trackChapters(tracks)));
    await writeFile(concatList, buildConcatList(unit.audioFiles));

    const durationMs = totalDurationMs(tracks);
    const output = join(outputDir, `${safeFileName(basename(unit.path))}.m4b`);
    const cover = tracks[0].probe.hasCover ? tracks[0].path : pickCoverImage(unit.extraFiles);
    const run = (withCover: boolean) =>
      this.runTracked(
        job,
        buildJoinArgs({ tracks: unit.audioFiles, concatList, metadataFile, cover: withCover ? cover : null }, output, plan),
        durationMs,
      );
    try {
      await run(cover !== null);
    } catch (err) {
      if (cover === null || job.abort?.signal.aborted) throw err;
      this.logger.warn(`[conversion.convert] [fail] jobId=${job.id} errorClass=CoverRejected - retrying without the cover`);
      await run(false);
    }
    job.progress = 100;
    await this.verify(output, durationMs);
    return { plan, output };
  }

  private async runTracked(job: TrackedJob, args: string[], durationMs: number): Promise<void> {
    job.abort = new AbortController();
    await runFfmpeg(this.ffmpegPath, args, {
      lowPriority: true,
      signal: job.abort.signal,
      onProgress: (outTimeUs: number) => {
        job.progress = Math.min(99, Math.max(0, Math.round((outTimeUs / 1000 / durationMs) * 100)));
      },
    });
  }

  private async convert(job: TrackedJob, source: string, output: string, plan: ConversionPlan, probe: AudioProbe): Promise<void> {
    if (plan.method === 'move') {
      await copyFile(source, output);
      job.progress = 100;
      return;
    }
    const run = (withCover: boolean) => this.runTracked(job, buildFfmpegArgs(source, output, plan, withCover), probe.durationMs);
    try {
      await run(probe.hasCover);
    } catch (err) {
      // Some cover formats cannot go into an M4B; the audio matters more than the picture.
      if (!probe.hasCover || job.abort?.signal.aborted) throw err;
      this.logger.warn(`[conversion.convert] [fail] jobId=${job.id} errorClass=CoverRejected - retrying without the embedded cover`);
      await run(false);
    }
    job.progress = 100;
  }

  private async verify(output: string, originalMs: number): Promise<void> {
    const converted = await probeAudio(this.ffprobePath, output);
    if (!sameLength(originalMs, converted.durationMs)) {
      throw new Error(`The M4B is ${Math.round(converted.durationMs / 1000)}s long but the original is ${Math.round(originalMs / 1000)}s`);
    }
  }

  private async copyExtras(unit: ConversionUnit, outputDir: string): Promise<void> {
    for (const extra of unit.extraFiles) {
      const target = join(outputDir, relative(unit.path, extra));
      await mkdir(dirname(target), { recursive: true });
      await copyFile(extra, target);
    }
  }

  /** Moves the finished file or folder into the Book Dock under a name nothing there uses yet. */
  private async handOff(source: string): Promise<string> {
    const root = await realpath(this.bookDockRoot).catch(() => this.bookDockRoot);
    await mkdir(root, { recursive: true });
    const target = await freeName(join(root, basename(source)));
    try {
      await rename(source, target);
    } catch (err) {
      if (!isCrossDeviceError(err)) throw err;
      await cp(source, target, { recursive: true, errorOnExist: true, force: false });
    }
    return target;
  }

  /**
   * The M4B is already in the Book Dock by now, so a failure here leaves the original where it was
   * rather than failing the job, which would invite converting it a second time.
   */
  private async removeOriginal(job: TrackedJob, unit: ConversionUnit): Promise<boolean> {
    const startedAt = Date.now();
    try {
      if (!(await this.recycleBin.isEnabled())) {
        await rm(unit.path, { recursive: true, force: true });
        return true;
      }
      await this.recycleBin.recycle(this.convertRoot, { kind: 'book', title: job.name, deletedBy: null, absolutePaths: unit.allFiles });
      if (unit.isDirectory) {
        // Deepest first, and only folders left empty: anything the bin did not take stays put.
        const folders = [...new Set(unit.allFiles.map((file) => dirname(file)))].sort((a, b) => b.length - a.length);
        for (const folder of folders) await removeEmptyDirs(folder, this.convertRoot);
      }
      return true;
    } catch (err) {
      this.logFail('conversion.remove_original', startedAt, err, `jobId=${job.id}`, 'original could not be removed');
      return false;
    }
  }

  private finish(
    job: TrackedJob,
    status: 'done' | 'failed' | 'waiting' | 'skipped',
    reason: ConversionReason | null,
    detail: string | null = null,
  ): void {
    job.status = status;
    job.reason = reason;
    job.detail = detail;
    job.progress = status === 'done' ? 100 : null;
    job.finishedAt = new Date().toISOString();
  }

  private trimFinished(): void {
    const finished = [...this.jobs.values()]
      .filter((job) => job.status === 'done' || job.status === 'skipped')
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    for (const job of finished.slice(0, Math.max(0, finished.length - FINISHED_JOBS_KEPT))) this.jobs.delete(job.id);
  }

  private logFail(event: string, startedAt: number, err: unknown, ids: string, message: string): void {
    const errorClass = err instanceof Error ? err.name : 'Error';
    const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
    this.logger.warn(
      `[${event}] [fail] ${ids ? `${ids} ` : ''}durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - ${message}`,
    );
  }
}

function toPublicJob(job: TrackedJob): ConversionJob {
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    method: job.method,
    progress: job.progress,
    bitrate: job.bitrate,
    trackCount: job.trackCount,
    reason: job.reason,
    detail: job.detail,
    outputName: job.outputName,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

const COVER_NAMES = ['cover', 'folder', 'front'];
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

/** A cover image from the folder: one named like a cover, else the first picture. */
function pickCoverImage(files: string[]): string | null {
  const images = files.filter((file) => IMAGE_EXTENSIONS.has(extname(file).toLowerCase()));
  const named = images.find((file) => COVER_NAMES.includes(basename(file, extname(file)).toLowerCase()));
  return named ?? images[0] ?? null;
}

/** A folder name is already a valid name on this disk; only path separators would break it. */
function safeFileName(name: string): string {
  return name.replace(/[/\\]/g, '-').trim() || 'Audiobook';
}

async function freeName(target: string): Promise<string> {
  if (!(await pathExists(target))) return target;
  const extension = extname(target);
  const stem = target.slice(0, target.length - extension.length);
  for (let attempt = 2; attempt <= COLLISION_ATTEMPTS_MAX; attempt += 1) {
    const candidate = `${stem} (${attempt})${extension}`;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error('The Book Dock already holds too many items with this name');
}

/** FFmpeg's own message is long; the log keeps all of it, the page shows its last line. */
function failureDetail(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? 'The conversion failed';
  return last.length > 300 ? `${last.slice(0, 297)}...` : last;
}
