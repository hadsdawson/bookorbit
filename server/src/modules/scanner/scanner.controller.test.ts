import { ScannerController } from './scanner.controller';

describe('ScannerController', () => {
  it('delegates scan requests to ScannerService.startScan with manual trigger', () => {
    const scannerService = { startScan: vi.fn().mockResolvedValue({ jobId: 11 }), refreshCovers: vi.fn() } as any;
    const controller = new ScannerController(scannerService, {} as any);

    void controller.scan(42);

    expect(scannerService.startScan).toHaveBeenCalledWith(42, 'manual');
  });

  it('delegates scan history requests with the caller-supplied limit', () => {
    const scannerService = { startScan: vi.fn(), refreshCovers: vi.fn(), getScanHistory: vi.fn().mockResolvedValue([]) } as any;
    const controller = new ScannerController(scannerService, {} as any);

    void controller.scanHistory(7, 5);

    expect(scannerService.getScanHistory).toHaveBeenCalledWith(7, 5);
  });

  it('delegates scan change requests with paging and the chosen kind of change', () => {
    const scannerService = { getScanChanges: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }) } as any;
    const controller = new ScannerController(scannerService, {} as any);

    void controller.scanChanges(7, 31, 50, 25, 'missing');

    expect(scannerService.getScanChanges).toHaveBeenCalledWith(7, 31, { offset: 50, limit: 25, type: 'missing' });
  });

  it('rejects an unknown kind of scan change', () => {
    const controller = new ScannerController({ getScanChanges: vi.fn() } as any, {} as any);

    expect(() => controller.scanChanges(7, 31, 0, 50, 'deleted')).toThrow('Unknown change type');
  });

  it('delegates cover refresh requests to ScannerService.refreshCovers', () => {
    const scannerService = { startScan: vi.fn(), refreshCovers: vi.fn().mockResolvedValue({ queued: 3 }) } as any;
    const controller = new ScannerController(scannerService, {} as any);

    void controller.refreshCovers(9);

    expect(scannerService.refreshCovers).toHaveBeenCalledWith(9);
  });

  it('starts and reads path-rule application for the calling user', () => {
    const regexReapply = { start: vi.fn().mockResolvedValue({ id: 'job' }), get: vi.fn().mockReturnValue(null) } as any;
    const controller = new ScannerController({} as any, regexReapply);
    const user = { id: 3, isSuperuser: false } as any;

    void controller.reapplyRegexMetadata(9, user);
    controller.getRegexReapply(9, user);

    expect(regexReapply.start).toHaveBeenCalledWith(9, user);
    expect(regexReapply.get).toHaveBeenCalledWith(9, user);
  });
});
