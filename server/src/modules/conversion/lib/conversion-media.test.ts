import { buildFfmpegArgs, isConvertible, parseProbe, planConversion, sameLength, targetBitrate } from './conversion-media';

describe('conversion media', () => {
  const mp3 = { durationMs: 600_000, codec: 'mp3', channels: 2, bitrate: 128_000, hasCover: true };

  it('accepts MP3, M4A and M4B files only', () => {
    expect(isConvertible('/c/Book.MP3')).toBe(true);
    expect(isConvertible('/c/Book.m4a')).toBe(true);
    expect(isConvertible('/c/Book.m4b')).toBe(true);
    expect(isConvertible('/c/cover.jpg')).toBe(false);
    expect(isConvertible('/c/Book.flac')).toBe(false);
  });

  it('reads the audio stream, length, bitrate and cover from ffprobe output', () => {
    const probe = parseProbe({
      streams: [
        { codec_type: 'audio', codec_name: 'mp3', channels: 1, bit_rate: '64000' },
        { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
      ],
      format: { duration: '3600.5', bit_rate: '70000' },
    });
    expect(probe).toEqual({ durationMs: 3_600_500, codec: 'mp3', channels: 1, bitrate: 64_000, hasCover: true });
  });

  it('falls back to the file bitrate and refuses a file with no audio', () => {
    expect(parseProbe({ streams: [{ codec_type: 'audio', codec_name: 'mp3' }], format: { duration: '10', bit_rate: '96000' } }).bitrate).toBe(96_000);
    expect(() => parseProbe({ streams: [], format: { duration: '10' } })).toThrow('no audio');
  });

  it('copies AAC audio, only moves an M4B, and re-encodes MP3', () => {
    expect(planConversion('/c/a.m4a', { ...mp3, codec: 'aac' })).toEqual({ method: 'copy', bitrate: null });
    expect(planConversion('/c/a.m4b', { ...mp3, codec: 'aac' })).toEqual({ method: 'move', bitrate: null });
    expect(planConversion('/c/a.mp3', mp3)).toEqual({ method: 'encode', bitrate: 128_000 });
  });

  it('matches the original bitrate, rounding up and never going below the floor', () => {
    expect(targetBitrate({ bitrate: 128_000, channels: 2 })).toBe(128_000);
    expect(targetBitrate({ bitrate: 127_995, channels: 2 })).toBe(128_000);
    expect(targetBitrate({ bitrate: 32_000, channels: 1 })).toBe(48_000);
    expect(targetBitrate({ bitrate: 64_000, channels: 2 })).toBe(96_000);
    expect(targetBitrate({ bitrate: null, channels: 2 })).toBe(128_000);
    expect(targetBitrate({ bitrate: 500_000, channels: 2 })).toBe(320_000);
  });

  it('builds one-thread FFmpeg arguments that keep tags and chapters', () => {
    const args = buildFfmpegArgs('/c/in.mp3', '/w/out.m4b', { method: 'encode', bitrate: 128_000 }, true);
    expect(args).toEqual(expect.arrayContaining(['-threads', '1', '-map_metadata', '0', '-map_chapters', '0', '-c:a', 'aac', '-b:a', '128000']));
    expect(args).toContain('attached_pic');
    expect(args.slice(-3)).toEqual(['-f', 'mp4', '/w/out.m4b']);
    expect(buildFfmpegArgs('/c/in.m4a', '/w/out.m4b', { method: 'copy', bitrate: null }, false)).not.toContain('attached_pic');
  });

  it('accepts a small difference in length only', () => {
    expect(sameLength(600_000, 599_975)).toBe(true);
    expect(sameLength(36_000_000, 36_150_000)).toBe(true);
    expect(sameLength(600_000, 590_000)).toBe(false);
  });
});
