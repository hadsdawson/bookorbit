import type { MetadataCandidate } from '@bookorbit/types';

import { tidyCandidateText } from './candidate-text';

const base = { provider: 'audible', providerId: 'B0' } as unknown as MetadataCandidate;

describe('tidyCandidateText', () => {
  it('collapses non-breaking, doubled and invisible spaces in names', () => {
    const tidied = tidyCandidateText({
      ...base,
      authors: ['Hank\u00a0 Green', 'Anna\u00a0Dorn', 'Zero\u200BWidth Name'],
      narrators: ['  Kate   Reading '],
    });
    expect(tidied.authors).toEqual(['Hank Green', 'Anna Dorn', 'ZeroWidth Name']);
    expect(tidied.narrators).toEqual(['Kate Reading']);
  });

  it('writes initials the way BookOrbit saves them and drops repeats that tidy into one', () => {
    const tidied = tidyCandidateText({ ...base, authors: ['A. J. Clack', 'A.J.\u00a0Clack', 'Hank Green', 'hank  green'] });
    expect(tidied.authors).toEqual(['A.J. Clack', 'Hank Green']);
  });

  it('tidies the title, subtitle, publisher and series name, and leaves the description alone', () => {
    const tidied = tidyCandidateText({
      ...base,
      title: 'Infinite\u00a0 Wisdom',
      subtitle: ' A  Novel ',
      publisher: 'Tor\u00a0Books',
      seriesName: 'Wisdom\u2060',
      description: '<p>Two  spaces</p>',
    });
    expect(tidied).toMatchObject({ title: 'Infinite Wisdom', subtitle: 'A Novel', publisher: 'Tor Books', seriesName: 'Wisdom' });
    expect(tidied.description).toBe('<p>Two  spaces</p>');
  });

  it('drops a text field that is only spaces rather than keeping an empty one', () => {
    expect(tidyCandidateText({ ...base, subtitle: '\u00a0 ' })).not.toHaveProperty('subtitle');
  });
});
