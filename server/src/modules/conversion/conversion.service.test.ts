import { execFile as execFileCallback } from 'child_process';
import { createRequire } from 'module';
import { appendFile, chmod, copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import type { ConversionJob } from '@bookorbit/types';

import { runFfmpeg } from '../file-write/formats/audio/ffmpeg-runner';
import { listEntryIds } from '../recycle-bin/lib/recycle-bin-store';
import { RECYCLE_BIN_SETTINGS_KEY, RecycleBinService } from '../recycle-bin/recycle-bin.service';
import { CONVERSION_SETTINGS_KEY, ConversionService, expectedOutputBytes, parseConversionSettings, progressFraction } from './conversion.service';

vi.mock('../file-write/formats/audio/ffmpeg-runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../file-write/formats/audio/ffmpeg-runner')>();
  return { ...actual, runFfmpeg: vi.fn(actual.runFfmpeg) };
});

const execFile = promisify(execFileCallback);
const requireInstaller = createRequire(__filename);
const ffmpegPath = (requireInstaller('@ffmpeg-installer/ffmpeg') as { path: string }).path;
const ffprobeInstallerPath = (requireInstaller('@ffprobe-installer/ffprobe') as { path: string }).path;

// These run real ffmpeg encodes, which can be slow on a busy CI runner with coverage on.
describe('ConversionService', { timeout: 60_000 }, () => {
  let root: string;
  let ffprobePath: string;
  let convertRoot: string;
  let dockRoot: string;
  let settings: Map<string, string>;
  let service: ConversionService;

  function makeService(): ConversionService {
    const values: Record<string, string> = {
      'storage.appDataPath': root,
      'storage.convertPath': convertRoot,
      'storage.bookDockPath': dockRoot,
      'audioTools.ffmpegPath': ffmpegPath,
      'audioTools.ffprobePath': ffprobePath,
    };
    const config = { get: (key: string) => values[key] };
    const appSettings = {
      getValue: vi.fn((key: string) => Promise.resolve(settings.get(key) ?? null)),
      setValue: vi.fn((key: string, value: string) => {
        settings.set(key, value);
        return Promise.resolve();
      }),
    };
    const recycleBin = new RecycleBinService({ findLibraryFolders: vi.fn().mockResolvedValue([]) } as never, appSettings as never);
    const created = new ConversionService(config as never, appSettings as never, recycleBin);
    // Test files are written in one go, so there is nothing to wait out.
    Object.assign(created, { settleQuietMs: 0, settlePollMs: 0 });
    return created;
  }

  async function makeAudio(path: string, codecArgs: string[]): Promise<void> {
    await execFile(ffmpegPath, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=3',
      '-ac',
      '2',
      '-metadata',
      'title=Test Book',
      ...codecArgs,
      path,
    ]);
  }

  async function waitForJob(name: string, statuses: ConversionJob['status'][]): Promise<ConversionJob> {
    for (let attempt = 0; attempt < 550; attempt += 1) {
      const job = (await service.overview()).jobs.find((candidate) => candidate.name === name);
      if (job && statuses.includes(job.status)) return job;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`${name} never reached ${statuses.join(' or ')}`);
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bookorbit-conversion-'));
    // The installer package does not always ship ffprobe as executable.
    ffprobePath = join(root, 'ffprobe');
    await copyFile(ffprobeInstallerPath, ffprobePath);
    await chmod(ffprobePath, 0o755);
    convertRoot = join(root, 'convert');
    dockRoot = join(root, 'book-dock');
    settings = new Map([[RECYCLE_BIN_SETTINGS_KEY, JSON.stringify({ enabled: true, keepDays: 30 })]]);
    service = makeService();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    await rm(root, { recursive: true, force: true });
  });

  it('reads stored settings, falling back to off and one at a time', () => {
    expect(parseConversionSettings(null)).toEqual({ enabled: false, concurrency: 1, speed: 'low' });
    expect(parseConversionSettings('{"enabled":true,"concurrency":3,"speed":"high"}')).toEqual({
      enabled: true,
      concurrency: 3,
      speed: 'high',
    });
    expect(parseConversionSettings('{"enabled":true,"concurrency":8,"speed":"turbo"}')).toEqual({
      enabled: true,
      concurrency: 1,
      speed: 'low',
    });
    expect(parseConversionSettings('not json')).toEqual({ enabled: false, concurrency: 1, speed: 'low' });
  });

  it('does nothing while turned off', async () => {
    await service.onApplicationBootstrap();
    expect((await service.overview()).jobs).toEqual([]);
    await expect(readdir(convertRoot)).rejects.toThrow();
  });

  it('re-encodes an MP3 at its own bitrate, hands it to the Book Dock and recycles the original', async () => {
    await mkdir(convertRoot, { recursive: true });
    await makeAudio(join(convertRoot, 'Book.mp3'), ['-c:a', 'libmp3lame', '-b:a', '128k']);
    await service.onApplicationBootstrap();
    await service.updateSettings({ enabled: true, concurrency: 1, speed: 'low' });

    const job = await waitForJob('Book.mp3', ['done', 'failed']);
    expect(job).toMatchObject({
      status: 'done',
      method: 'encode',
      bitrate: 128_000,
      outputName: 'Book.m4b',
      progress: 100,
      reason: null,
      phase: null,
    });
    expect(job.originalDurationMs).toBeCloseTo(3_000, -2);
    expect(Math.abs(job.checkedDurationMs! - job.originalDurationMs!)).toBeLessThanOrEqual(2_000);
    expect(await readdir(dockRoot)).toEqual(['Book.m4b']);
    const { stdout } = await execFile(ffprobePath, [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_name:format_tags=title',
      '-of',
      'csv=p=0',
      join(dockRoot, 'Book.m4b'),
    ]);
    expect(stdout).toContain('aac');
    expect(stdout).toContain('Test Book');
    expect((await readdir(convertRoot)).filter((name) => !name.startsWith('.'))).toEqual([]);
    expect(await listEntryIds(convertRoot)).toHaveLength(1);
    expect(JSON.parse(settings.get(CONVERSION_SETTINGS_KEY)!)).toEqual({ enabled: true, concurrency: 1, speed: 'low' });
  });

  it('copies the audio of an M4A in a folder and carries the cover and metadata along', async () => {
    const folder = join(convertRoot, 'Some Author - Book');
    await mkdir(folder, { recursive: true });
    await makeAudio(join(folder, 'Book.m4a'), ['-c:a', 'aac', '-b:a', '96k']);
    await writeFile(join(folder, 'cover.jpg'), 'jpg');
    await writeFile(join(folder, 'metadata.json'), '{}');
    settings.set(CONVERSION_SETTINGS_KEY, JSON.stringify({ enabled: true, concurrency: 2 }));
    await service.onApplicationBootstrap();

    const job = await waitForJob('Some Author - Book', ['done', 'failed']);
    expect(job).toMatchObject({ status: 'done', method: 'copy', bitrate: null, outputName: 'Some Author - Book' });
    expect((await readdir(join(dockRoot, 'Some Author - Book'))).sort()).toEqual(['Book.m4b', 'cover.jpg', 'metadata.json']);
    expect((await readdir(convertRoot)).filter((name) => !name.startsWith('.'))).toEqual([]);
  });

  it('deletes the original outright when the recycle bin is off', async () => {
    settings.set(RECYCLE_BIN_SETTINGS_KEY, JSON.stringify({ enabled: false, keepDays: 30 }));
    settings.set(CONVERSION_SETTINGS_KEY, JSON.stringify({ enabled: true, concurrency: 1 }));
    await mkdir(convertRoot, { recursive: true });
    await makeAudio(join(convertRoot, 'Book.m4a'), ['-c:a', 'aac', '-b:a', '64k']);
    await service.onApplicationBootstrap();

    await waitForJob('Book.m4a', ['done']);
    expect(await listEntryIds(convertRoot)).toEqual([]);
    expect((await readdir(convertRoot)).filter((name) => !name.startsWith('.'))).toEqual([]);
  });

  it('joins a folder of MP3 tracks into one M4B with a chapter per track and the folder cover', async () => {
    const tracks = join(convertRoot, 'Some Book');
    await mkdir(tracks, { recursive: true });
    await makeAudio(join(tracks, '01 - Opening.mp3'), ['-c:a', 'libmp3lame', '-b:a', '96k']);
    await makeAudio(join(tracks, '02 - Storm.mp3'), ['-c:a', 'libmp3lame', '-b:a', '128k']);
    await execFile(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1', '-frames:v', '1', join(tracks, 'cover.jpg')]);
    await writeFile(join(convertRoot, 'notes.txt'), 'hello');
    settings.set(CONVERSION_SETTINGS_KEY, JSON.stringify({ enabled: true, concurrency: 1 }));
    await service.onApplicationBootstrap();

    const job = await waitForJob('Some Book', ['done', 'failed']);
    expect(job).toMatchObject({ status: 'done', method: 'encode', bitrate: 128_000, trackCount: 2, outputName: 'Some Book' });
    expect((await readdir(join(dockRoot, 'Some Book'))).sort()).toEqual(['Some Book.m4b', 'cover.jpg']);
    const m4b = join(dockRoot, 'Some Book', 'Some Book.m4b');
    const chapters = await execFile(ffprobePath, ['-v', 'error', '-show_entries', 'chapter_tags=title', '-of', 'csv=p=0', m4b]);
    expect(chapters.stdout.trim().split('\n')).toEqual(['Opening', 'Storm']);
    const streams = await execFile(ffprobePath, ['-v', 'error', '-show_entries', 'stream=codec_name:format=duration', '-of', 'csv=p=0', m4b]);
    expect(streams.stdout).toContain('aac');
    expect(streams.stdout).toContain('mjpeg');
    expect(await waitForJob('notes.txt', ['skipped'])).toMatchObject({ reason: 'no_audio' });
  });

  it('joins matching M4A tracks without re-encoding them', async () => {
    const tracks = join(convertRoot, 'Copied');
    await mkdir(join(tracks, 'CD2'), { recursive: true });
    await makeAudio(join(tracks, '01.m4a'), ['-c:a', 'aac', '-b:a', '64k']);
    await makeAudio(join(tracks, 'CD2', '01.m4a'), ['-c:a', 'aac', '-b:a', '64k']);
    settings.set(CONVERSION_SETTINGS_KEY, JSON.stringify({ enabled: true, concurrency: 1 }));
    await service.onApplicationBootstrap();

    const job = await waitForJob('Copied', ['done', 'failed']);
    expect(job).toMatchObject({ status: 'done', method: 'copy', trackCount: 2 });
    const { stdout } = await execFile(ffprobePath, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      join(dockRoot, 'Copied', 'Copied.m4b'),
    ]);
    expect(Number(stdout)).toBeCloseTo(6, 0);
  });

  it('fails a file that is not really audio and keeps the original for a retry', async () => {
    await mkdir(convertRoot, { recursive: true });
    await writeFile(join(convertRoot, 'Broken.mp3'), 'not audio');
    settings.set(CONVERSION_SETTINGS_KEY, JSON.stringify({ enabled: true, concurrency: 1 }));
    await service.onApplicationBootstrap();

    const job = await waitForJob('Broken.mp3', ['failed']);
    expect(job).toMatchObject({ reason: 'failed', detail: expect.any(String) });
    expect(await readdir(convertRoot)).toContain('Broken.mp3');
    expect(service.retry(job.id).status).toBe('queued');
    await waitForJob('Broken.mp3', ['failed']);
  });

  it('waits for a file still being copied in and queues it only once', async () => {
    Object.assign(service, { settleQuietMs: 600, settlePollMs: 100 });
    await mkdir(convertRoot, { recursive: true });
    const path = join(convertRoot, 'Copying.mp3');
    await makeAudio(path, ['-c:a', 'libmp3lame']);
    const consider = (service as unknown as { consider: (path: string) => Promise<void> }).consider.bind(service);

    const first = consider(path);
    const second = consider(path);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await appendFile(path, Buffer.alloc(0));
    await appendFile(path, 'x');
    await Promise.all([first, second]);

    const jobs = (await service.overview()).jobs.filter((job) => job.name === 'Copying.mp3');
    expect(jobs).toHaveLength(1);
  });

  it('reports progress from bytes written when FFmpeg gives no position', () => {
    expect(progressFraction(30_000_000, 100, 60_000, 1_000)).toBe(0.5);
    expect(progressFraction(Number.NaN, 250, 60_000, 1_000)).toBe(0.25);
    expect(progressFraction(Number.NaN, Number.NaN, 60_000, 1_000)).toBeNull();
    expect(expectedOutputBytes({ method: 'encode', bitrate: 128_000 }, 60_000, 5)).toBe(960_000);
    expect(expectedOutputBytes({ method: 'copy', bitrate: null }, 60_000, 5)).toBe(5);
  });

  it('counts waiting and converting items for the sidebar', () => {
    expect(service.activeCount()).toBe(0);
  });

  it('runs FFmpeg at low priority on Low speed and at normal priority on High', async () => {
    await mkdir(convertRoot, { recursive: true });
    await makeAudio(join(convertRoot, 'Low.m4a'), ['-c:a', 'aac', '-b:a', '64k']);
    settings.set(CONVERSION_SETTINGS_KEY, JSON.stringify({ enabled: true, concurrency: 1, speed: 'low' }));
    await service.onApplicationBootstrap();
    await waitForJob('Low.m4a', ['done']);
    expect(vi.mocked(runFfmpeg).mock.lastCall?.[2]).toMatchObject({ lowPriority: true });

    await service.updateSettings({ enabled: true, concurrency: 1, speed: 'high' });
    await makeAudio(join(convertRoot, 'Normal.m4a'), ['-c:a', 'aac', '-b:a', '64k']);
    // Handed over directly: whether the folder watcher reports the new file within the test's time
    // depends on how busy the machine is, and the watcher is not what this test is about.
    await (service as unknown as { consider: (path: string) => Promise<void> }).consider(join(convertRoot, 'Normal.m4a'));
    await waitForJob('Normal.m4a', ['done']);
    expect(vi.mocked(runFfmpeg).mock.lastCall?.[2]).toMatchObject({ lowPriority: false });
  });

  it('keeps the original and fails when the finished M4B reads through shorter than the original', async () => {
    await mkdir(convertRoot, { recursive: true });
    await makeAudio(join(convertRoot, 'Short.m4a'), ['-c:a', 'aac', '-b:a', '64k']);
    const actual = vi.mocked(runFfmpeg).getMockImplementation()!;
    vi.mocked(runFfmpeg)
      .mockImplementationOnce(actual)
      .mockImplementationOnce((_binary, _args, options) => {
        options?.onProgress?.({ outTimeUs: 300_000, totalSize: Number.NaN });
        return Promise.resolve();
      });
    settings.set(CONVERSION_SETTINGS_KEY, JSON.stringify({ enabled: true, concurrency: 1, speed: 'low' }));
    await service.onApplicationBootstrap();

    const job = await waitForJob('Short.m4a', ['done', 'failed']);
    expect(job).toMatchObject({
      status: 'failed',
      reason: 'length_mismatch',
      detail: expect.stringContaining('plays for 0:00:00 but the original plays for 0:00:03'),
    });
    expect(await readdir(convertRoot)).toContain('Short.m4a');
    await expect(readdir(dockRoot)).rejects.toThrow();
  });

  it('measures an MP3 that does not state its length by reading it through', async () => {
    await mkdir(convertRoot, { recursive: true });
    await makeAudio(join(convertRoot, 'NoHeader.mp3'), ['-c:a', 'libmp3lame', '-b:a', '64k', '-write_xing', '0']);
    settings.set(CONVERSION_SETTINGS_KEY, JSON.stringify({ enabled: true, concurrency: 1, speed: 'low' }));
    await service.onApplicationBootstrap();

    const job = await waitForJob('NoHeader.mp3', ['done', 'failed']);
    expect(job.status).toBe('done');
    expect(job.originalDurationMs).toBeCloseTo(3_000, -2);
    const readThroughs = vi.mocked(runFfmpeg).mock.calls.filter(([, args]) => args.includes('null'));
    expect(readThroughs.length).toBeGreaterThanOrEqual(2);
  });

  it('carries narrator, year, genre, description and series from the first track onto a joined book', async () => {
    const tracks = join(convertRoot, 'Tagged Book');
    await mkdir(tracks, { recursive: true });
    const bookTagArgs = [
      '-metadata',
      'album=Lean Mean Thirteen',
      '-metadata',
      'album_artist=Janet Evanovich',
      '-metadata',
      'composer=Lorelei King',
      '-metadata',
      'date=2007',
      '-metadata',
      'genre=Mystery',
      '-metadata',
      'comment=A description',
      '-metadata',
      'SERIES=Stephanie Plum',
      '-metadata',
      'SERIES-PART=13',
    ];
    await makeAudio(join(tracks, '01 - One.mp3'), ['-c:a', 'libmp3lame', '-metadata', 'title=One', '-metadata', 'track=1', ...bookTagArgs]);
    await makeAudio(join(tracks, '02 - Two.mp3'), ['-c:a', 'libmp3lame', '-metadata', 'title=Two', '-metadata', 'track=2', ...bookTagArgs]);
    settings.set(CONVERSION_SETTINGS_KEY, JSON.stringify({ enabled: true, concurrency: 1, speed: 'low' }));
    await service.onApplicationBootstrap();

    await waitForJob('Tagged Book', ['done']);
    const m4b = join(dockRoot, 'Tagged Book', 'Tagged Book.m4b');
    const { stdout } = await execFile(ffprobePath, ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', m4b]);
    const tags = Object.fromEntries(
      Object.entries((JSON.parse(stdout) as { format: { tags: Record<string, string> } }).format.tags).map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    );
    expect(tags).toMatchObject({
      title: 'Lean Mean Thirteen',
      album: 'Lean Mean Thirteen',
      album_artist: 'Janet Evanovich',
      composer: 'Lorelei King',
      date: '2007',
      genre: 'Mystery',
      comment: 'A description',
      series: 'Stephanie Plum',
      'series-part': '13',
    });
    expect(tags.track).toBeUndefined();
  });

  it("keeps an MP3 book's series when converting it on its own", async () => {
    await mkdir(convertRoot, { recursive: true });
    await makeAudio(join(convertRoot, 'Single.mp3'), [
      '-c:a',
      'libmp3lame',
      '-metadata',
      'SERIES=Stephanie Plum',
      '-metadata',
      'composer=Lorelei King',
    ]);
    settings.set(CONVERSION_SETTINGS_KEY, JSON.stringify({ enabled: true, concurrency: 1, speed: 'low' }));
    await service.onApplicationBootstrap();

    await waitForJob('Single.mp3', ['done']);
    const { stdout } = await execFile(ffprobePath, ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', join(dockRoot, 'Single.m4b')]);
    const tags = Object.fromEntries(
      Object.entries((JSON.parse(stdout) as { format: { tags: Record<string, string> } }).format.tags).map(([key, value]) => [
        key.toLowerCase(),
        value,
      ]),
    );
    expect(tags).toMatchObject({ series: 'Stephanie Plum', composer: 'Lorelei King' });
  });
});
