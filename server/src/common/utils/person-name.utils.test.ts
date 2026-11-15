import { describe, expect, it } from 'vitest';

import { joinNameInitials, normalizePersonName, normalizePersonNameKey } from './person-name.utils';

describe('person name initials', () => {
  it.each([
    ['A. J. Clack', 'A.J. Clack'],
    ['J. R. R. Tolkien', 'J.R.R. Tolkien'],
    ['A.J. Clack', 'A.J. Clack'],
    ['Clack, A. J.', 'Clack, A.J.'],
    ['Élodie A. B. Ćosić', 'Élodie A.B. Ćosić'],
    ['George R. R. Martin', 'George R.R. Martin'],
    ['Dr. J. Smith', 'Dr. J. Smith'],
    ['J. Smith', 'J. Smith'],
    ['A J Clack', 'A J Clack'],
  ])('%s -> %s', (input, expected) => {
    expect(joinNameInitials(input)).toBe(expected);
  });

  it('normalizes whitespace before joining initials', () => {
    expect(normalizePersonName('  A.  J.   Clack ')).toBe('A.J. Clack');
    expect(normalizePersonName('   ')).toBeNull();
  });

  it('gives spaced and joined initials the same key', () => {
    expect(normalizePersonNameKey('A. J. Clack')).toBe(normalizePersonNameKey('a.j. clack'));
  });
});
