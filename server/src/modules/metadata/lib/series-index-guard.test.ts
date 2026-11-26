import { withoutLoneSeriesIndex } from './series-index-guard';

describe('withoutLoneSeriesIndex', () => {
  it('drops a number with no name, or a blank name', () => {
    expect(withoutLoneSeriesIndex({ seriesName: null, seriesIndex: '3', title: 'A' })).toEqual({ seriesName: null, seriesIndex: null, title: 'A' });
    expect(withoutLoneSeriesIndex({ seriesName: '  ', seriesIndex: '3' })).toEqual({ seriesName: '  ', seriesIndex: null });
    expect(withoutLoneSeriesIndex({ seriesIndex: '1' })).toEqual({ seriesIndex: null });
  });

  it('leaves named numbers, empty numbers and null alone', () => {
    const named = { seriesName: 'Hades', seriesIndex: '3' };
    expect(withoutLoneSeriesIndex(named)).toBe(named);
    const empty = { seriesName: null, seriesIndex: null };
    expect(withoutLoneSeriesIndex(empty)).toBe(empty);
    expect(withoutLoneSeriesIndex(null)).toBeNull();
  });
});
