import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { AuthorBooksPage } from '@bookorbit/types'

const fetchAuthorBooks = vi.hoisted(() => vi.fn<(authorId: number) => Promise<AuthorBooksPage>>())
vi.mock('../../api/author', () => ({ fetchAuthorBooks }))
vi.mock('vue-router', async (importOriginal) => ({ ...(await importOriginal<typeof import('vue-router')>()), useRoute: () => ({ hash: '' }) }))

import AuthorPenNameBooks from '../AuthorPenNameBooks.vue'

function mountSection(bookCount: number) {
  return mount(AuthorPenNameBooks, {
    props: {
      penName: { id: 40, name: 'A. Deborah Baker', bookCount },
      viewMode: 'grid',
      coverSize: 140,
      gridGap: 16,
      sort: 'addedAt',
      order: 'desc',
      libraryId: null,
      collapseSeries: false,
    },
    global: { stubs: { VirtualBookGrid: true, BookListRow: true } },
  })
}

describe('AuthorPenNameBooks', () => {
  it('says there are no books yet without asking for them when the pen name has none', async () => {
    fetchAuthorBooks.mockReset()
    const wrapper = mountSection(0)
    await flushPromises()
    expect(fetchAuthorBooks).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="pen-name-empty"]').text()).toBe('No books under this name yet.')
    expect(wrapper.text()).not.toContain('Failed')
  })

  it('loads the books of a pen name that has some', async () => {
    fetchAuthorBooks.mockReset().mockResolvedValue({ items: [{ id: 1 }], total: 1, bookTotal: 1, page: 0, size: 50 } as never)
    const wrapper = mountSection(1)
    await flushPromises()
    expect(fetchAuthorBooks).toHaveBeenCalledWith(40, expect.objectContaining({ page: 0 }))
    expect(wrapper.find('[data-testid="pen-name-empty"]').exists()).toBe(false)
  })
})
