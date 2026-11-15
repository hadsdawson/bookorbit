import { autoTrackingStatus, isTrackingManual } from '@bookorbit/types';

describe('request tracking status from the release date', () => {
  it.each([
    ['pending', null, 'format_not_available'],
    ['pending', '2026-12-01', 'not_yet_released'],
    ['searching', '2026-11-14', 'missing'],
    ['failed', '2025-01-01', 'missing'],
    ['available', '2026-12-01', null],
    ['cancelled', null, null],
    ['rejected', '2025-01-01', null],
  ])('%s with release date %s reads %s', (status, date, expected) => {
    expect(autoTrackingStatus(status, date, '2026-11-14')).toBe(expected);
  });

  it('treats a status set on an older row as chosen by hand, and an empty one as automatic', () => {
    expect(isTrackingManual(null, 'missing')).toBe(true);
    expect(isTrackingManual(null, null)).toBe(false);
    expect(isTrackingManual('manual', null)).toBe(true);
    expect(isTrackingManual('auto', null)).toBe(false);
  });
});
