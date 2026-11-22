import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { Permission } from '@bookorbit/types'
import { usePermissions } from '@/features/auth/composables/usePermissions'

const SEQUENCE_TIMEOUT_MS = 1500

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function useRequestShortcuts() {
  const router = useRouter()
  const { hasPermission } = usePermissions()

  let pendingKey: 'g' | 'r' | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function clearPending() {
    pendingKey = null
    if (timer) clearTimeout(timer)
    timer = null
  }

  function armPending(key: 'g' | 'r') {
    clearPending()
    pendingKey = key
    timer = setTimeout(clearPending, SEQUENCE_TIMEOUT_MS)
  }

  function goToRequests() {
    const tab = hasPermission(Permission.ManageBookRequests) ? 'all' : 'mine'
    void router.push({ name: 'book-requests', query: { tab } })
  }

  function goToRequestBook() {
    void router.push({ name: 'book-requests', query: { tab: 'search' } })
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return
    if (isTypingTarget(event.target)) return

    const key = event.key.toLowerCase()
    const previous = pendingKey
    clearPending()

    if (previous === 'g' && key === 'r') {
      event.preventDefault()
      goToRequests()
      return
    }
    if (previous === 'r' && key === 'b') {
      event.preventDefault()
      goToRequestBook()
      return
    }
    if (key === 'g' || key === 'r') armPending(key)
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown))
  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
    clearPending()
  })
}
