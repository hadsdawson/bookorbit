import { getCurrentScope, onScopeDispose } from 'vue'

import { fetchUpcomingReleases } from '../api/dashboard-widget.api'
import { useWidgetData } from './useWidgetData'

/** Often enough that a book requested, hidden or newly found shows up, and the day rolls over. */
export const UPCOMING_RELEASES_REFRESH_MS = 15 * 60 * 1000

export function useUpcomingReleasesWidget() {
  const widget = useWidgetData(fetchUpcomingReleases)

  function refreshWhenVisible() {
    if (document.visibilityState === 'visible') void widget.refresh()
  }

  const timer = setInterval(refreshWhenVisible, UPCOMING_RELEASES_REFRESH_MS)
  document.addEventListener('visibilitychange', refreshWhenVisible)
  if (getCurrentScope()) {
    onScopeDispose(() => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    })
  }

  return widget
}
