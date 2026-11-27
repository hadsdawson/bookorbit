import { describe, expect, it } from 'vitest'
import { BOOK_DOCK_HOLD_REASONS } from '@bookorbit/types'
import { i18n } from '@/i18n'
import { HOLD_REASON_ORDER, duplicateExplanation, holdChipText, holdReasonLabel, holdStyle } from '../hold-reason'

const t = (key: string, params?: Record<string, unknown>) => i18n.global.t(key, params ?? {})

describe('hold reasons', () => {
  it('orders, words and styles every reason the server sends', () => {
    expect([...HOLD_REASON_ORDER].sort()).toEqual([...BOOK_DOCK_HOLD_REASONS].sort())
    for (const reason of BOOK_DOCK_HOLD_REASONS) {
      expect(holdReasonLabel(reason, t)).not.toContain('bookDock.')
      expect(holdStyle(reason).icon).toBeTruthy()
    }
  })

  it('reads an unknown reason as a plain wait', () => {
    expect(holdReasonLabel('newer_reason', t)).toBe('Waiting for review')
    expect(holdStyle('newer_reason').tone).toBe('grey')
  })

  it('puts the facts in the chip when the server sent them, and the short name when not', () => {
    expect(holdChipText({ holdReason: 'duplicate', holdDetail: { libraryName: 'Fiction' } }, t)).toBe('Already in Fiction')
    expect(holdChipText({ holdReason: 'unsupported_layout', holdDetail: { libraryName: 'Comics' } }, t)).toBe("Doesn't fit Comics")
    expect(holdChipText({ holdReason: 'low_confidence', holdDetail: null }, t)).toBe('Low match')
    expect(holdChipText({ holdReason: null, holdDetail: null }, t)).toBe('')
  })
  it('says which book a duplicate matched and why, and calls an unlikely match a possible one (fork)', () => {
    const suspect = {
      holdReason: 'duplicate' as const,
      holdDetail: { libraryName: 'Shelf', bookId: 9, matchReason: 'work_id' as const, matchTitle: 'The Stars Are Dying', suspect: true },
    }
    expect(holdChipText(suspect, t)).toBe('Possible match in Shelf, check it')
    expect(duplicateExplanation(suspect, t)).toBe('Matches “The Stars Are Dying” in Shelf, because both have the same Hardcover or Open Library ID.')
    expect(duplicateExplanation({ holdReason: 'duplicate', holdDetail: { libraryName: 'Shelf', matchReason: 'same_path' } }, t)).toBe(
      'Matches a book in Shelf, because both have the same file name in the same folder.',
    )
    expect(duplicateExplanation({ holdReason: 'duplicate', holdDetail: { libraryName: 'Shelf', bookId: 9 } }, t)).toBeNull()
  })
})
