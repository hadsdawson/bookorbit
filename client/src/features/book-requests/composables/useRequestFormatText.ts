import { ref } from 'vue'

const STORAGE_KEY = 'bookorbit.requests.formatText'

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'shown'
  } catch {
    return false
  }
}

const shown = ref(readStored())

export function useRequestFormatText() {
  function setShown(next: boolean): void {
    shown.value = next
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'shown' : 'hidden')
    } catch {
      // A preference that cannot be persisted still applies for this session.
    }
  }

  return { shown, setShown }
}
