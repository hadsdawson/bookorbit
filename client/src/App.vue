<script setup lang="ts">
import { watch } from 'vue'
import { useRoute } from 'vue-router'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import ChangePasswordDialog from '@/features/auth/ChangePasswordDialog.vue'
import WhatsNewDialog from '@/features/whats-new/WhatsNewDialog.vue'
import { useWhatsNew } from '@/features/whats-new/composables/useWhatsNew'
import { useAuth } from '@/features/auth/composables/useAuth'
import { useSessionBootstrap } from '@/features/auth/composables/useSessionBootstrap'
import ServerReconnectScreen from '@/features/auth/components/ServerReconnectScreen.vue'
import TtsMiniPlayer from '@/features/tts/components/TtsMiniPlayer.vue'
import MediaOverlayMiniPlayer from '@/features/reader/media-overlay/components/MediaOverlayMiniPlayer.vue'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { resolveRouteViewKey } from '@/router/view-key'
import LegalNotices from '@/components/legal/LegalNotices.vue'

// Toasts sit at the top centre so they never cover bottom-edge action buttons,
// the audio/TTS mini players, or bulk-action bars.
const TOASTER_OFFSET = {
  top: '16px',
}
const TOASTER_MOBILE_OFFSET = {
  top: '16px',
  left: '16px',
  right: '16px',
}

const { isOpen } = useChangePasswordDialog()

const route = useRoute()
const { user } = useAuth()
const { unreachable: serverUnreachable } = useSessionBootstrap()
const { popupOpen, evaluate, syncPopup } = useWhatsNew()

watch(
  () => user.value,
  async (current) => {
    if (!current) return
    await evaluate()
    syncPopup(route.name as string | undefined)
  },
  { immediate: true },
)

watch(
  () => route.name,
  (name) => syncPopup(name as string | undefined),
)
</script>

<template>
  <TooltipProvider :delay-duration="0">
    <ServerReconnectScreen v-if="serverUnreachable" />
    <router-view v-slot="{ Component, route: activeRoute }">
      <Transition name="page" mode="out-in">
        <component :is="Component" :key="resolveRouteViewKey(activeRoute)" />
      </Transition>
    </router-view>
    <ChangePasswordDialog v-if="isOpen" />
    <WhatsNewDialog v-if="popupOpen" />
    <LegalNotices />
    <TtsMiniPlayer />
    <MediaOverlayMiniPlayer />
    <Toaster rich-colors position="top-center" :visible-toasts="5" :gap="8" :offset="TOASTER_OFFSET" :mobile-offset="TOASTER_MOBILE_OFFSET" />
  </TooltipProvider>
</template>
