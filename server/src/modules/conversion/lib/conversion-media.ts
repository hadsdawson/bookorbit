import { execFile } from 'child_process';
import { basename, extname } from 'path';
import { promisify } from 'util';

import type { ConversionMethod } from '@bookorbit/types';

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 120_000;
const PROBE_MAX_BUFFER = 8 * 1024 * 1024;

/** Audio files this version converts. Anything else in the Convert folder is left alone. */
export const CONVERTIBLE_EXTENSIONS = new Set(['.mp3', '.m4a', '.m4b']);

/** Codecs an M4B can hold as they are, so the audio is copied rather than re-encoded. */
const COPYABLE_CODECS = new Set(['aac', 'alac']);

const BITRATE_STEP = 8_000;
const BITRATE_MAX = 320_000;
const BITRATE_UNKNOWN_PER_CHANNEL = 64_000;
/**
 * FFmpeg's built-in AAC encoder needs a little more room than MP3 at very low bitrates to sound the
 * same, so a re-encode never goes below this per channel even when the original did.
 */
const BITRATE_FLOOR_PER_CHANNEL = 48_000;

const DURATION_TOLERANCE_MS = 2_000;
/** Each MP3 track carries a few milliseconds of encoder padding, so joined books get a little more room per track. */
const DURATION_TOLERANCE_PER_TRACK_MS = 100;
const ESTIMATED_DURATION_RE = /Estimating duration from bitrate/i;

export interface AudioProbe {
  durationMs: number;
  codec: string;
  channels: number;
  sampleRate: number | null;
  bitrate: number | null;
  hasCover: boolean;
  tags: AudioTags;
  /** The file does not state its length, so ffprobe guessed it from the bitrate (common for MP3s). */
  estimated: boolean;
}

export interface AudioTags {
  title?: string;
  album?: string;
  artist?: string;
}

export interface ConversionPlan {
  method: ConversionMethod;
  /** Bits per second for a re-encode; null when the audio is copied or only moved. */
  bitrate: number | null;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  channels?: number;
  sample_rate?: string;
  bit_rate?: string;
  disposition?: { attached_pic?: number };
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string; bit_rate?: string; tags?: Record<string, string> };
}

export function isConvertible(path: string): boolean {
  return CONVERTIBLE_EXTENSIONS.has(extname(path).toLowerCase());
}

export async function probeAudio(ffprobePath: string, path: string): Promise<AudioProbe> {
  const { stdout, stderr } = await execFileAsync(ffprobePath, ['-v', 'warning', '-print_format', 'json', '-show_streams', '-show_format', path], {
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: PROBE_MAX_BUFFER,
  });
  return { ...parseProbe(JSON.parse(stdout) as FfprobeOutput), estimated: ESTIMATED_DURATION_RE.test(stderr) };
}

export function parseProbe(output: FfprobeOutput): AudioProbe {
  const streams = output.streams ?? [];
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  if (!audio) throw new Error('The file has no audio');
  const durationSeconds = Number(output.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('The length of the audio could not be read');
  const streamBitrate = Number(audio.bit_rate);
  const formatBitrate = Number(output.format?.bit_rate);
  const bitrate = streamBitrate > 0 ? streamBitrate : formatBitrate > 0 ? formatBitrate : null;
  const sampleRate = Number(audio.sample_rate);
  return {
    durationMs: Math.round(durationSeconds * 1000),
    codec: audio.codec_name ?? 'unknown',
    channels: audio.channels && audio.channels > 0 ? audio.channels : 2,
    sampleRate: sampleRate > 0 ? sampleRate : null,
    bitrate,
    hasCover: streams.some((stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic === 1),
    tags: readTags(output.format?.tags),
    estimated: false,
  };
}

export function planConversion(path: string, probe: AudioProbe): ConversionPlan {
  if (extname(path).toLowerCase() === '.m4b' && COPYABLE_CODECS.has(probe.codec)) return { method: 'move', bitrate: null };
  if (COPYABLE_CODECS.has(probe.codec)) return { method: 'copy', bitrate: null };
  return { method: 'encode', bitrate: targetBitrate(probe) };
}

/** The original's bitrate, rounded up, so the M4B keeps the original's quality. */
export function targetBitrate(probe: Pick<AudioProbe, 'bitrate' | 'channels'>): number {
  const channels = Math.min(Math.max(probe.channels, 1), 2);
  const source = probe.bitrate ?? BITRATE_UNKNOWN_PER_CHANNEL * channels;
  const floored = Math.max(source, BITRATE_FLOOR_PER_CHANNEL * channels);
  return Math.min(Math.ceil(floored / BITRATE_STEP) * BITRATE_STEP, BITRATE_MAX);
}

export function buildFfmpegArgs(input: string, output: string, plan: ConversionPlan, includeCover: boolean): string[] {
  const audio = plan.method === 'encode' ? ['-c:a', 'aac', '-b:a', String(plan.bitrate)] : ['-c:a', 'copy'];
  const cover = includeCover ? ['-map', '0:v:0', '-c:v', 'copy', '-disposition:v:0', 'attached_pic'] : [];
  return [
    '-nostdin',
    '-hide_banner',
    '-y',
    '-threads',
    '1',
    '-i',
    input,
    '-map',
    '0:a:0',
    ...cover,
    '-map_metadata',
    '0',
    '-map_chapters',
    '0',
    ...audio,
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    output,
  ];
}

/** How far apart two lengths may be and still count as the same book: 2 seconds, plus a little per joined track. */
export function allowedDifferenceMs(trackCount: number): number {
  return DURATION_TOLERANCE_MS + DURATION_TOLERANCE_PER_TRACK_MS * Math.max(0, trackCount - 1);
}

/** The output is kept only when it holds audio of the same length as the original. */
export function sameLength(originalMs: number, convertedMs: number, trackCount = 1): boolean {
  return Math.abs(originalMs - convertedMs) <= allowedDifferenceMs(trackCount);
}

/**
 * Decodes every frame of the first audio stream and throws the output away. FFmpeg's final position
 * is then the real length, and `-xerror` makes damaged audio fail the run instead of being skipped.
 */
export function buildReadThroughArgs(path: string): string[] {
  return ['-nostdin', '-hide_banner', '-v', 'error', '-xerror', '-threads', '1', '-i', path, '-map', '0:a:0', '-f', 'null', '-'];
}

function readTags(raw: Record<string, string> | undefined): AudioTags {
  const tags: AudioTags = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) continue;
    const name = key.toLowerCase();
    if (name === 'title') tags.title = text;
    else if (name === 'album') tags.album = text;
    else if ((name === 'artist' || name === 'album_artist') && !tags.artist) tags.artist = text;
  }
  return tags;
}

export interface Track {
  path: string;
  probe: AudioProbe;
}

export interface Chapter {
  title: string;
  startMs: number;
  endMs: number;
}

/** Most audiobooks ship a few dozen tracks; this keeps one FFmpeg command line within reason. */
export const JOIN_TRACKS_MAX = 500;

/**
 * Tracks join without re-encoding only when every one is AAC (or ALAC) with the same sample rate
 * and channel count; otherwise the whole book is encoded once, matching its best track.
 */
export function planJoin(tracks: Track[]): ConversionPlan {
  const [first] = tracks;
  const copyable = tracks.every(
    (track) =>
      COPYABLE_CODECS.has(track.probe.codec) &&
      track.probe.codec === first.probe.codec &&
      track.probe.sampleRate === first.probe.sampleRate &&
      track.probe.channels === first.probe.channels,
  );
  if (copyable) return { method: 'copy', bitrate: null };
  const best = tracks.reduce((top, track) => ((track.probe.bitrate ?? 0) > (top.probe.bitrate ?? 0) ? track : top), first);
  const channels = Math.max(...tracks.map((track) => track.probe.channels));
  return { method: 'encode', bitrate: targetBitrate({ bitrate: best.probe.bitrate, channels }) };
}

/** One chapter per track, named by its title tag when the tracks carry distinct ones, else by file name. */
export function trackChapters(tracks: Track[]): Chapter[] {
  const titles = tracks.map((track) => track.probe.tags.title);
  const useTags = titles.every(Boolean) && new Set(titles).size === titles.length;
  let startMs = 0;
  return tracks.map((track, index) => {
    const title = useTags ? titles[index]! : chapterNameFromFile(track.path, index);
    const chapter = { title, startMs, endMs: startMs + track.probe.durationMs };
    startMs = chapter.endMs;
    return chapter;
  });
}

/** "03 - The Storm.mp3" becomes "The Storm"; a bare "03.mp3" becomes "Chapter 3". */
export function chapterNameFromFile(path: string, index: number): string {
  const stem = basename(path, extname(path)).trim();
  const withoutNumber = stem.replace(/^(track|part|chapter|disc|cd)?\s*\d+\s*[-_.)\]:]*\s*/i, '').trim();
  return withoutNumber || `Chapter ${index + 1}`;
}

export function totalDurationMs(tracks: Track[]): number {
  return tracks.reduce((sum, track) => sum + track.probe.durationMs, 0);
}

/** FFmpeg's metadata file format, with its special characters escaped. */
export function buildFfmetadata(tags: AudioTags, chapters: Chapter[]): string {
  const lines = [';FFMETADATA1'];
  if (tags.title) lines.push(`title=${escapeMetadata(tags.title)}`);
  if (tags.album) lines.push(`album=${escapeMetadata(tags.album)}`);
  if (tags.artist) lines.push(`artist=${escapeMetadata(tags.artist)}`);
  for (const chapter of chapters) {
    lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${chapter.startMs}`, `END=${chapter.endMs}`, `title=${escapeMetadata(chapter.title)}`);
  }
  return `${lines.join('\n')}\n`;
}

function escapeMetadata(value: string): string {
  return value.replace(/[\\=;#\n]/g, (char) => `\\${char}`);
}

/** FFmpeg's concat list format: each path in single quotes, with quotes inside it escaped. */
export function buildConcatList(paths: string[]): string {
  return paths.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
}

export interface JoinInputs {
  tracks: string[];
  /** The concat list file, used when the audio is copied. */
  concatList: string;
  metadataFile: string;
  /** A file holding the cover: an image, or a track with an embedded picture. */
  cover: string | null;
}

export function buildJoinArgs(inputs: JoinInputs, output: string, plan: ConversionPlan): string[] {
  const audioInputs =
    plan.method === 'copy' ? ['-f', 'concat', '-safe', '0', '-i', inputs.concatList] : inputs.tracks.flatMap((track) => ['-i', track]);
  const audioCount = plan.method === 'copy' ? 1 : inputs.tracks.length;
  const metadataIndex = audioCount;
  const coverIndex = audioCount + 1;
  const audioMap =
    plan.method === 'copy'
      ? ['-map', '0:a:0', '-c:a', 'copy']
      : [
          '-filter_complex',
          `${inputs.tracks.map((_, index) => `[${index}:a:0]`).join('')}concat=n=${inputs.tracks.length}:v=0:a=1[audio]`,
          '-map',
          '[audio]',
          '-c:a',
          'aac',
          '-b:a',
          String(plan.bitrate),
        ];
  const cover = inputs.cover ? ['-map', `${coverIndex}:v:0`, '-c:v', 'copy', '-disposition:v:0', 'attached_pic'] : [];
  return [
    '-nostdin',
    '-hide_banner',
    '-y',
    '-threads',
    '1',
    ...audioInputs,
    '-i',
    inputs.metadataFile,
    ...(inputs.cover ? ['-i', inputs.cover] : []),
    ...audioMap,
    ...cover,
    '-map_metadata',
    String(metadataIndex),
    '-map_chapters',
    String(metadataIndex),
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    output,
  ];
}
