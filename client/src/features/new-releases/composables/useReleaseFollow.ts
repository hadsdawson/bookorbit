import { computed, ref, watch, type MaybeRefOrGetter, toValue } from 'vue'
import { Permission, type ReleaseFollow, type ReleaseFollowKind } from '@bookorbit/types'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'

import { usePermissions } from '@/features/auth/composables/usePermissions'
import { errorMessage } from '@/lib/api-json'
import { findReleaseFollow, followForReleases, unfollowForReleases } from '../api/new-releases'

/** The Follow button on an author or series page: whether this user follows it, and toggling that. */
export function useReleaseFollow(
  kind: ReleaseFollowKind,
  name: MaybeRefOrGetter<string | null | undefined>,
  ids: MaybeRefOrGetter<{ authorId?: number; seriesId?: number }>,
) {
  const { t } = useI18n()
  const { hasPermission } = usePermissions()
  const allowed = computed(() => hasPermission(Permission.NewReleasesAccess))
  const follow = ref<ReleaseFollow | null>(null)
  const loading = ref(false)
  const busy = ref(false)
  let generation = 0

  async function load(): Promise<void> {
    const current = ++generation
    const value = toValue(name)?.trim()
    if (!allowed.value || !value) {
      follow.value = null
      return
    }
    loading.value = true
    try {
      const found = await findReleaseFollow(kind, value)
      if (current === generation) follow.value = found
    } catch {
      if (current === generation) follow.value = null
    } finally {
      if (current === generation) loading.value = false
    }
  }

  async function toggle(): Promise<void> {
    const value = toValue(name)?.trim()
    if (!value || busy.value) return
    busy.value = true
    try {
      if (follow.value) {
        await unfollowForReleases(follow.value.id)
        follow.value = null
        toast.success(t('newReleases.follow.unfollowed', { name: value }))
      } else {
        follow.value = await followForReleases({ kind, name: value, ...toValue(ids) })
        toast.success(t('newReleases.follow.followed', { name: value }))
      }
    } catch (error) {
      toast.error(errorMessage(error, follow.value ? 'newReleases.errors.unfollow' : 'newReleases.errors.follow'))
    } finally {
      busy.value = false
    }
  }

  watch(() => [toValue(name), allowed.value] as const, load, { immediate: true })

  return { allowed, follow, following: computed(() => follow.value !== null), loading, busy, toggle }
}
