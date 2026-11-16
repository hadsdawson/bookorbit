import { BadRequestException, ConflictException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';

import { ConversionUploadService, safeUploadPath } from './conversion-upload.service';
import { CONVERSION_UPLOAD_DIR } from './conversion.service';

describe('ConversionUploadService', () => {
  let root: string;
  let convertRoot: string;
  let enabled: boolean;
  let service: ConversionUploadService;

  function stream(text: string, truncated = false): Readable {
    return Object.assign(Readable.from([Buffer.from(text)]), { truncated });
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bookorbit-conversion-upload-'));
    convertRoot = join(root, 'convert');
    await mkdir(convertRoot, { recursive: true });
    enabled = true;
    const config = { get: (key: string) => ({ 'storage.appDataPath': root, 'storage.convertPath': convertRoot })[key] };
    const conversions = { isEnabled: () => Promise.resolve(enabled) };
    service = new ConversionUploadService(config as never, conversions as never);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('keeps a folder upload hidden until it finishes, then moves it into the Convert folder', async () => {
    const { batchId } = await service.start();
    await service.receive(batchId, 'My Book/01.mp3', stream('one'), 1024);
    await service.receive(batchId, 'My Book/02.mp3', stream('two'), 1024);
    expect((await readdir(convertRoot)).filter((name) => !name.startsWith('.'))).toEqual([]);

    await expect(service.finish(batchId)).resolves.toEqual({ items: 1 });

    expect(await readdir(join(convertRoot, 'My Book'))).toEqual(['01.mp3', '02.mp3']);
    expect(await readdir(join(convertRoot, CONVERSION_UPLOAD_DIR))).toEqual([]);
  });

  it('gives a second file with the same name a number before its extension', async () => {
    await writeFile(join(convertRoot, 'Book.mp3'), 'old');
    const { batchId } = await service.start();
    await service.receive(batchId, 'Book.mp3', stream('new'), 1024);
    await service.finish(batchId);

    expect(await readFile(join(convertRoot, 'Book (2).mp3'), 'utf8')).toBe('new');
  });

  it('removes a file cut short by the upload limit', async () => {
    const { batchId } = await service.start();
    await expect(service.receive(batchId, 'Big.mp3', stream('partial', true), 1_048_576)).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(service.finish(batchId)).resolves.toEqual({ items: 0 });
  });

  it('refuses uploads while conversions are off and batches it never started', async () => {
    enabled = false;
    await expect(service.start()).rejects.toBeInstanceOf(ConflictException);
    enabled = true;
    await expect(service.finish('7f1e9a52-1111-4222-8333-944455556666')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps file paths inside the upload', () => {
    expect(safeUploadPath('My Book\\CD1/01.mp3')).toBe(join('My Book', 'CD1', '01.mp3'));
    for (const bad of ['', '/etc/passwd', '../escape.mp3', 'Book/../../x.mp3', '.hidden/a.mp3', 'a/b/c/d/e/f/g.mp3']) {
      expect(() => safeUploadPath(bad)).toThrow(BadRequestException);
    }
  });
});
