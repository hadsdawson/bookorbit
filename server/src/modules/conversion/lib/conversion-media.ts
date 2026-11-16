import { execFile } from 'child_process';
import { extname } from 'path';
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
const DURATION_TOLERANCE_RATIO = 0.005;

export interface AudioProbe {
  durationMs: number;
  codec: string;
  channels: number;
  bitrate: number | null;
  hasCover: boolean;
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
  bit_rate?: string;
  disposition?: { attached_pic?: number };
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string; bit_rate?: string };
}

export function isConvertible(path: string): boolean {
  return CONVERTIBLE_EXTENSIONS.has(extname(path).toLowerCase());
}

export async function probeAudio(ffprobePath: string, path: string): Promise<AudioProbe> {
  const { stdout } = await execFileAsync(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path], {
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: PROBE_MAX_BUFFER,
  });
  return parseProbe(JSON.parse(stdout) as FfprobeOutput);
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
  return {
    durationMs: Math.round(durationSeconds * 1000),
    codec: audio.codec_name ?? 'unknown',
    channels: audio.channels && audio.channels > 0 ? audio.channels : 2,
    bitrate,
    hasCover: streams.some((stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic === 1),
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

/** The output is kept only when it holds audio of the same length as the original. */
export function sameLength(originalMs: number, convertedMs: number): boolean {
  const tolerance = Math.max(DURATION_TOLERANCE_MS, originalMs * DURATION_TOLERANCE_RATIO);
  return Math.abs(originalMs - convertedMs) <= tolerance;
}
