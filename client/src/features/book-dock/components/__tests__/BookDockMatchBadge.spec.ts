import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import BookDockMatchBadge from '../BookDockMatchBadge.vue'

function mountBadge(props: InstanceType<typeof BookDockMatchBadge>['$props']) {
  return mount(BookDockMatchBadge, { props, attachTo: document.body })
}

describe('BookDockMatchBadge', () => {
  it('shows the points each field earned when hovered', async () => {
    const wrapper = mountBadge({
      confidence: 85,
      badgeClass: '',
      breakdown: {
        kind: 'fields',
        score: 85,
        parts: [
          { field: 'title', points: 55, max: 55, compared: true },
          { field: 'authors', points: 30, max: 30, compared: true },
          { field: 'year', points: 0, max: 10, compared: false },
          { field: 'series', points: 0, max: 5, compared: false },
        ],
      },
    })

    expect(wrapper.text()).toContain('85% match')
    await wrapper.find('button').trigger('mouseenter')
    await nextTick()

    const card = document.body.querySelector('[data-testid="match-breakdown-fields"]')
    expect(card?.textContent).toContain('Title')
    expect(card?.textContent).toContain('55 / 55')
    expect(card?.textContent).toContain('not compared')
    expect(document.body.textContent).toContain('Not compared means')
    wrapper.unmount()
  })

  it('explains an ISBN match in one sentence when tapped', async () => {
    const wrapper = mountBadge({ confidence: 95, badgeClass: '', breakdown: { kind: 'isbn', match: 'isbn13', score: 95 } })

    await wrapper.find('button').trigger('click')
    await nextTick()

    expect(document.body.querySelector('[data-testid="match-breakdown-isbn"]')?.textContent).toContain('ISBN-13')
    wrapper.unmount()
  })

  it('says when no breakdown is available and flags a weak match', async () => {
    const wrapper = mountBadge({ confidence: 60, badgeClass: '', breakdown: null })

    await wrapper.find('button').trigger('click')
    await nextTick()

    expect(document.body.textContent).toContain('No breakdown is available')
    expect(document.body.textContent).toContain('Under 85% counts as a weak match.')
    wrapper.unmount()
  })
})
