import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SeriesNameMatch } from '@bookorbit/types'
import SeriesChoice from '../SeriesChoice.vue'
import PendingSeriesNotice from '../PendingSeriesNotice.vue'

const apiMock = vi.fn<(url: string) => Promise<Response>>()
vi.mock('@/lib/api', () => ({ api: (url: string) => apiMock(url) }))

const PopoverStub = defineComponent({ name: 'PopoverStub', props: { open: Boolean }, template: '<div><slot /></div>' })
const passthrough = { template: '<div><slot /></div>' }

function match(id: number, authors: string[], bookCount = 3): SeriesNameMatch {
  return { id, name: 'Wisdom', bookCount, authors, moreAuthorCount: 0, coverBookIds: [id * 10, id * 10 + 1] }
}

function respond(matches: SeriesNameMatch[]) {
  apiMock.mockImplementation(async () => new Response(JSON.stringify(matches), { status: 200 }))
}

async function mountChoice(props: Partial<InstanceType<typeof SeriesChoice>['$props']> = {}) {
  const wrapper = mount(SeriesChoice, {
    props: { seriesName: 'Wisdom', seriesId: null, newSeries: false, edited: false, ...props },
    global: { stubs: { Popover: PopoverStub, PopoverTrigger: passthrough, PopoverContent: passthrough } },
  })
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
  return wrapper
}

describe('SeriesChoice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apiMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists every series that shares the name and asks for a pick', async () => {
    respond([match(4, ['Thomas R. Weaver']), match(9, ['Ann Other'], 1)])
    const wrapper = await mountChoice()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/series/by-name?name=Wisdom')
    const options = wrapper.findAll('[data-testid="series-choice-option"]')
    expect(options).toHaveLength(2)
    expect(options[0]!.text()).toContain('Thomas R. Weaver')
    expect(options[0]!.text()).toContain('#4')
    expect(options[1]!.text()).toContain('1 book')
    expect(wrapper.text()).toContain('2 series are named Wisdom')
    expect(wrapper.find('[data-testid="series-choice-view"]').attributes()).toMatchObject({ href: '/series/4', target: '_blank' })
  })

  it('emits the picked series and a new-series request', async () => {
    respond([match(4, ['A']), match(9, ['B'])])
    const wrapper = await mountChoice()

    await wrapper.findAll('[data-testid="series-choice-pick"]')[1]!.trigger('click')
    await wrapper.find('[data-testid="series-choice-new"]').trigger('click')

    expect(wrapper.emitted('pick')).toEqual([[9]])
    expect(wrapper.emitted('startNew')).toHaveLength(1)
  })

  it('marks the picked series and drops the warning', async () => {
    respond([match(4, ['A']), match(9, ['B'])])
    const wrapper = await mountChoice({ seriesId: 9 })

    const picks = wrapper.findAll('[data-testid="series-choice-pick"]')
    expect(picks[0]!.attributes('aria-pressed')).toBe('false')
    expect(picks[1]!.attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).not.toContain('series are named')
  })

  it('stays hidden for a single match the person did not just type', async () => {
    respond([match(4, ['A'])])
    const untouched = await mountChoice()
    expect(untouched.find('[data-testid="series-choice"]').exists()).toBe(false)

    const typed = await mountChoice({ edited: true })
    expect(typed.find('[data-testid="series-choice"]').exists()).toBe(true)
    expect(typed.text()).toContain('This book will join this series.')
  })

  it('shows the first covers when Preview is hovered', async () => {
    respond([match(4, ['A']), match(9, ['B'])])
    const wrapper = await mountChoice()

    const popovers = wrapper.findAllComponents(PopoverStub)
    expect(popovers.map((p) => p.props('open'))).toEqual([false, false])

    await wrapper.find('[data-testid="series-choice-preview"]').trigger('mouseenter')
    expect(popovers.map((p) => p.props('open'))).toEqual([true, false])
    expect(wrapper.findAll('[data-testid="series-choice-covers"]')[0]!.findAll('img')).toHaveLength(2)

    await wrapper.find('[data-testid="series-choice-preview"]').trigger('mouseleave')
    expect(popovers[0]!.props('open')).toBe(false)
  })
})

describe('PendingSeriesNotice', () => {
  it('names the waiting series and asks to choose', async () => {
    const wrapper = mount(PendingSeriesNotice, {
      props: { pending: [{ seriesName: 'Wisdom', seriesIndex: '2', displayOrder: 0 }] },
    })

    expect(wrapper.text()).toContain('Choose series: Wisdom #2')
    await wrapper.trigger('click')
    expect(wrapper.emitted('choose')).toHaveLength(1)
  })

  it('renders nothing with no waiting series', () => {
    const wrapper = mount(PendingSeriesNotice, { props: { pending: [] } })
    expect(wrapper.find('[data-testid="pending-series-notice"]').exists()).toBe(false)
  })
})
