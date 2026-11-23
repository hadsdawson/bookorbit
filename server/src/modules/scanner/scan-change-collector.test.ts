import { recordScanChange, ScanChangeCollector, scanChangeStorage } from './scan-change-collector';

describe('ScanChangeCollector', () => {
  it('keeps one entry per book and kind of change and merges their field changes', () => {
    const collector = new ScanChangeCollector();

    collector.record(1, 'updated', [{ field: 'Title', old: 'A', new: 'B' }], '/lib/a');
    collector.record(1, 'updated', [{ field: 'File removed', old: 'a.epub', new: null }]);
    collector.record(1, 'missing');

    expect(collector.entries).toHaveLength(2);
    const updated = collector.entries.find((entry) => entry.changeType === 'updated');
    expect(updated?.fieldChanges.map((change) => change.field)).toEqual(['Title', 'File removed']);
    expect(updated?.folderPath).toBe('/lib/a');
  });

  it('stops adding books past the cap and says the list is incomplete', () => {
    const collector = new ScanChangeCollector(2);

    collector.record(1, 'added');
    collector.record(2, 'added');
    collector.record(3, 'added');
    collector.record(2, 'added', [{ field: 'File added', old: null, new: 'x.epub' }]);

    expect(collector.entries.map((entry) => entry.bookId)).toEqual([1, 2]);
    expect(collector.truncated).toBe(true);
    expect(collector.entries[1].fieldChanges).toHaveLength(1);
  });

  it('shortens very long values so one description cannot bloat a scan', () => {
    const collector = new ScanChangeCollector();

    collector.record(1, 'updated', [{ field: 'Description', old: 'x'.repeat(5000), new: 'short' }]);

    const change = collector.entries[0].fieldChanges[0];
    expect(change.old!.length).toBeLessThan(500);
    expect(change.old!.endsWith('...')).toBe(true);
    expect(change.new).toBe('short');
  });

  it('records through the running scan and does nothing outside one', () => {
    const collector = new ScanChangeCollector();

    recordScanChange(1, 'added');
    scanChangeStorage.run(collector, () => recordScanChange(2, 'added'));

    expect(collector.entries.map((entry) => entry.bookId)).toEqual([2]);
  });
});
