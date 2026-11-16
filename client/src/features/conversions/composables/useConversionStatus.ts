import { ref } from 'vue'

import { getConversionStatus } from '../api/conversions'

const enabled = ref(false)
let loading: Promise<void> | null = null

/** Whether conversions are turned on, which decides if the Conversions tab is shown at all. */
export function useConversionStatus() {
  function load(): Promise<void> {
    loading ??= getConversionStatus()
      .then((status) => {
        enabled.value = status.enabled
      })
      .catch(() => {
        enabled.value = false
        loading = null
      })
    return loading
  }

  function setEnabled(value: boolean): void {
    enabled.value = value
  }

  return { enabled, load, setEnabled }
}
