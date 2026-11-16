import {
  bookTags,
  buildConcatList,
  buildFfmetadata,
  buildFfmpegArgs,
  buildJoinArgs,
  buildReadThroughArgs,
  chapterNameFromFile,
  isConvertible,
  parseProbe,
  planConversion,
  planJoin,
  sameLength,
  targetBitrate,
  trackChapters,
  type AudioProbe,
  type Track,
} from './conversion-media';

describe('conversion media', () => {
  const mp3: AudioProbe = {
    durationMs: 600_000,
    codec: 'mp3',
    channels: 2,
    sampleRate: 44_100,
    bitrate: 128_000,
    hasCover: true,
    tags: {},
    allTags: {},
    estimated: false,
  };

  function track(path: string, probe: Partial<AudioProbe> = {}): Track {
    return { path, probe: { ...mp3, hasCover: false, ...probe } };
  }

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
    expect(probe).toEqual({
      durationMs: 3_600_500,
      codec: 'mp3',
      channels: 1,
      sampleRate: null,
      bitrate: 64_000,
      hasCover: true,
      tags: {},
      allTags: {},
      estimated: false,
    });
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

  it('accepts two seconds of difference, plus a tenth of a second per joined track', () => {
    expect(sameLength(36_000_000, 35_998_500)).toBe(true);
    expect(sameLength(36_000_000, 35_997_000)).toBe(false);
    expect(sameLength(36_000_000, 36_150_000)).toBe(false);
    expect(sameLength(36_000_000, 35_994_000, 50)).toBe(true);
    expect(sameLength(36_000_000, 35_990_000, 50)).toBe(false);
  });

  it('reads the whole first audio stream and stops on damaged audio', () => {
    const args = buildReadThroughArgs('/w/Book.m4b');
    expect(args).toEqual(expect.arrayContaining(['-xerror', '-map', '0:a:0', '-f', 'null', '-threads', '1']));
    expect(args.at(-1)).toBe('-');
  });

  it('reads title, album and artist tags whatever their case', () => {
    const probe = parseProbe({
      streams: [{ codec_type: 'audio', codec_name: 'mp3', sample_rate: '44100' }],
      format: { duration: '10', tags: { TITLE: 'Part 1', Album: 'The Book', album_artist: 'Writer', artist: 'Reader' } },
    });
    expect(probe.sampleRate).toBe(44_100);
    expect(probe.tags).toEqual({ title: 'Part 1', album: 'The Book', artist: 'Writer' });
  });

  it('joins matching AAC tracks without re-encoding and encodes anything else at the best track bitrate', () => {
    const aac = { codec: 'aac', bitrate: 64_000 };
    expect(planJoin([track('/a/1.m4a', aac), track('/a/2.m4a', aac)])).toEqual({ method: 'copy', bitrate: null });
    expect(planJoin([track('/a/1.m4a', aac), track('/a/2.m4a', { ...aac, sampleRate: 22_050 })]).method).toBe('encode');
    expect(planJoin([track('/a/1.mp3', { bitrate: 96_000 }), track('/a/2.mp3', { bitrate: 128_000 })])).toEqual({
      method: 'encode',
      bitrate: 128_000,
    });
  });

  it('makes one chapter per track, named by distinct title tags or else by file name', () => {
    const tagged = trackChapters([
      track('/a/01.mp3', { durationMs: 1_000, tags: { title: 'Opening' } }),
      track('/a/02.mp3', { durationMs: 2_000, tags: { title: 'Storm' } }),
    ]);
    expect(tagged).toEqual([
      { title: 'Opening', startMs: 0, endMs: 1_000 },
      { title: 'Storm', startMs: 1_000, endMs: 3_000 },
    ]);
    const sameTags = trackChapters([
      track('/a/01 - Opening.mp3', { tags: { title: 'Book' } }),
      track('/a/02 - Storm.mp3', { tags: { title: 'Book' } }),
    ]);
    expect(sameTags.map((chapter) => chapter.title)).toEqual(['Opening', 'Storm']);
  });

  it('turns track file names into chapter names', () => {
    expect(chapterNameFromFile('/a/03 - The Storm.mp3', 2)).toBe('The Storm');
    expect(chapterNameFromFile('/a/Track 07.mp3', 6)).toBe('Chapter 7');
    expect(chapterNameFromFile('/a/Part 2_ Arrival.mp3', 1)).toBe('Arrival');
    expect(chapterNameFromFile('/a/Prologue.mp3', 0)).toBe('Prologue');
  });

  it('escapes metadata and quotes concat paths', () => {
    const text = buildFfmetadata({ title: 'A=B; #1' }, [{ title: 'One', startMs: 0, endMs: 5 }]);
    expect(text).toBe(';FFMETADATA1\ntitle=A\\=B\\; \\#1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=5\ntitle=One\n');
    expect(buildConcatList(["/a/It's 1.m4a", '/a/2.m4a'])).toBe("file '/a/It'\\''s 1.m4a'\nfile '/a/2.m4a'\n");
  });

  it('feeds tracks through the concat list when copying and the concat filter when encoding', () => {
    const inputs = { tracks: ['/a/1.mp3', '/a/2.mp3'], concatList: '/w/tracks.txt', metadataFile: '/w/meta.txt', cover: '/a/cover.jpg' };
    const copy = buildJoinArgs(inputs, '/w/Book.m4b', { method: 'copy', bitrate: null });
    expect(copy).toEqual(expect.arrayContaining(['-f', 'concat', '-safe', '0', '/w/tracks.txt', '-map', '0:a:0', '2:v:0']));
    expect(copy.join(' ')).toContain('-map_metadata 1 -map_chapters 1');
    const encode = buildJoinArgs({ ...inputs, cover: null }, '/w/Book.m4b', { method: 'encode', bitrate: 128_000 });
    expect(encode).toContain('[0:a:0][1:a:0]concat=n=2:v=0:a=1[audio]');
    expect(encode.join(' ')).toContain('-map_metadata 2 -map_chapters 2');
    expect(encode).not.toContain('attached_pic');
  });

  it('keeps book-level tags, sorts out the ones FFmpeg cannot write, and drops per-track ones', () => {
    const tags = bookTags(
      {
        title: 'Chapter 2',
        track: '2/30',
        album: 'Lean Mean Thirteen',
        album_artist: 'Janet Evanovich',
        composer: 'Lorelei King',
        date: '2007',
        genre: 'Mystery',
        comment: 'A description',
        series: 'Stephanie Plum',
        'SERIES-PART': '13',
        encoder: 'Lavf60',
        iTunSMPB: '00000000 00000210',
        'lyrics-eng': 'words',
      },
      new Set(['title', 'album', 'album_artist', 'composer', 'date', 'genre', 'comment']),
    );
    expect(tags.native).toEqual({
      album: 'Lean Mean Thirteen',
      album_artist: 'Janet Evanovich',
      composer: 'Lorelei King',
      date: '2007',
      genre: 'Mystery',
      comment: 'A description',
    });
    expect(tags.freeform).toEqual([
      { name: 'SERIES', value: 'Stephanie Plum' },
      { name: 'SERIES-PART', value: '13' },
    ]);
  });

  it('writes any tag into the metadata file', () => {
    expect(buildFfmetadata({ composer: 'Lorelei King', title: 'Book' }, [])).toBe(';FFMETADATA1\ncomposer=Lorelei King\ntitle=Book\n');
  });
});
