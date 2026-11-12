<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, ArchiveRestore, Download, HardDriveDownload, Loader2, Trash2, Upload } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { BACKUP_KEEP_MAX, BACKUP_KEEP_MIN, type BackupFrequency, type BackupInfo, type BackupSettings } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { formatDateTime } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { useBackups } from './backups/useBackups'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
const { t } = useI18n()
const backups = useBackups()
const { overview, loading, busy, error, restarting, restartTimedOut } = backups

const form = ref<BackupSettings | null>(null)
const restoreTarget = ref<BackupInfo | null>(null)
const deleteTarget = ref<BackupInfo | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const weekdays = computed(() =>
  [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    value: day,
    label: new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + day))),
  })),
)
const frequencies: BackupFrequency[] = ['daily', 'weekly', 'off']
const dirty = computed(() => !!form.value && !!overview.value && JSON.stringify(form.value) !== JSON.stringify(overview.value.settings))
const timeZoneDiffers = computed(() => !!form.value && form.value.timeZone !== browserTimeZone)

onMounted(() => void backups.load())

watch(
  () => overview.value?.settings,
  (settings) => {
    if (!settings) return
    // A schedule never saved from a browser is still on the server default, UTC; offer this browser's zone.
    form.value = settings.timeZone === 'UTC' && browserTimeZone !== 'UTC' ? { ...settings, timeZone: browserTimeZone } : { ...settings }
  },
  { immediate: true },
)

function kindLabel(backup: BackupInfo): string {
  return t(`settings.backups.kinds.${backup.kind}`)
}

function handleFrequencyChange(event: Event) {
  if (form.value) form.value.frequency = (event.target as HTMLSelectElement).value as BackupFrequency
}

function handleDayChange(event: Event) {
  if (form.value) form.value.dayOfWeek = Number((event.target as HTMLSelectElement).value)
}

function handleTimeChange(event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (form.value && value) form.value.time = value
}

function handleKeepChange(event: Event) {
  const value = Math.round(Number((event.target as HTMLInputElement).value))
  if (form.value && Number.isFinite(value)) form.value.keep = Math.min(BACKUP_KEEP_MAX, Math.max(BACKUP_KEEP_MIN, value))
}

function handleBeforeUpdateChange(value: boolean) {
  if (form.value) form.value.beforeUpdate = value
}

function handleRequireBeforeUpdateChange(value: boolean) {
  if (form.value) form.value.requireBeforeUpdate = value
}

function handleUseMyTimeZone() {
  if (form.value) form.value.timeZone = browserTimeZone
}

async function handleSave() {
  if (!form.value) return
  const saved = await backups.saveSettings({ ...form.value })
  if (saved) toast.success(t('settings.backups.saved'))
}

async function handleCreate() {
  const backup = await backups.createNow()
  if (backup) toast.success(t('settings.backups.created', { size: formatBytes(backup.size) }))
}

function handleChooseUpload() {
  fileInput.value?.click()
}

async function handleUploadChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const backup = await backups.upload(file)
  if (backup) toast.success(t('settings.backups.uploaded'))
}

function handleDownload(backup: BackupInfo) {
  void backups.download(backup.name)
}

function handleAskRestore(backup: BackupInfo) {
  restoreTarget.value = backup
}

function handleAskDelete(backup: BackupInfo) {
  deleteTarget.value = backup
}

function handleCancelRestore() {
  restoreTarget.value = null
}

function handleCancelDelete() {
  deleteTarget.value = null
}

async function handleConfirmRestore() {
  const target = restoreTarget.value
  if (!target) return
  const started = await backups.restore(target.name)
  restoreTarget.value = null
  if (!started) toast.error(error.value ?? t('settings.backups.restoreFailed'))
}

async function handleConfirmDelete() {
  const target = deleteTarget.value
  if (!target) return
  const removed = await backups.remove(target.name)
  deleteTarget.value = null
  if (removed) toast.success(t('settings.backups.deleted'))
}
</script>

<template>
  <SettingsPageHeader v-if="!props.embedded" class="hidden md:flex" :title="t('settings.backups.title')" :subtitle="t('settings.backups.subtitle')" />
  <div v-if="!props.embedded" class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ t('settings.backups.title') }}</h1>
    <p class="mt-1 text-sm text-muted-foreground leading-5">{{ t('settings.backups.subtitle') }}</p>
  </div>

  <div v-if="restarting" class="settings-card mt-5 md:mt-0" role="status" aria-live="polite">
    <div class="flex items-start gap-3 px-4 py-4 md:px-5">
      <Loader2 v-if="!restartTimedOut" class="mt-0.5 size-5 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
      <AlertTriangle v-else class="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
      <div class="min-w-0">
        <p class="settings-label">{{ t(restartTimedOut ? 'settings.backups.restartSlowTitle' : 'settings.backups.restartingTitle') }}</p>
        <p class="settings-hint settings-prose">{{ t(restartTimedOut ? 'settings.backups.restartSlow' : 'settings.backups.restarting') }}</p>
      </div>
    </div>
  </div>

  <div v-else-if="loading" class="settings-loading-state" :class="{ 'mt-5 md:mt-0': !props.embedded }">
    <Loader2 class="size-5 animate-spin text-muted-foreground" />
  </div>

  <div v-else-if="overview && form" class="space-y-4" :class="{ 'mt-5 md:mt-0': !props.embedded }">
    <div v-if="overview.lastRestore" class="settings-card" role="status">
      <div class="flex items-start gap-3 px-4 py-3.5 md:px-5">
        <ArchiveRestore v-if="overview.lastRestore.ok" class="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <AlertTriangle v-else class="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
        <div class="min-w-0">
          <p class="settings-label">
            {{
              t(overview.lastRestore.ok ? 'settings.backups.lastRestoreOk' : 'settings.backups.lastRestoreFailed', {
                date: formatDateTime(new Date(overview.lastRestore.finishedAt)),
              })
            }}
          </p>
          <p v-if="overview.lastRestore.error" class="settings-hint settings-prose">{{ overview.lastRestore.error }}</p>
          <p v-if="overview.lastRestore.safetyBackup" class="settings-hint settings-prose">{{ t('settings.backups.safetyNote') }}</p>
        </div>
      </div>
    </div>

    <div v-if="overview.lastError" class="settings-card" role="alert">
      <div class="flex items-start gap-3 px-4 py-3.5 md:px-5">
        <AlertTriangle class="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
        <div class="min-w-0">
          <p class="settings-label">{{ t('settings.backups.lastErrorTitle') }}</p>
          <p class="settings-hint settings-prose break-words">{{ overview.lastError }}</p>
        </div>
      </div>
    </div>

    <section aria-labelledby="backups-schedule-heading" class="space-y-2">
      <h2 id="backups-schedule-heading" class="settings-group-label">{{ t('settings.backups.schedule') }}</h2>
      <div class="settings-card">
        <div class="settings-row">
          <div class="min-w-0">
            <p class="settings-label">{{ t('settings.backups.frequency') }}</p>
            <p class="settings-hint">{{ t('settings.backups.frequencyHint') }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2 md:ml-4">
            <select class="select-field w-32" :aria-label="t('settings.backups.frequency')" :value="form.frequency" @change="handleFrequencyChange">
              <option v-for="frequency in frequencies" :key="frequency" :value="frequency">
                {{ t(`settings.backups.frequencies.${frequency}`) }}
              </option>
            </select>
            <select
              v-if="form.frequency === 'weekly'"
              class="select-field w-36"
              :aria-label="t('settings.backups.day')"
              :value="form.dayOfWeek"
              @change="handleDayChange"
            >
              <option v-for="day in weekdays" :key="day.value" :value="day.value">{{ day.label }}</option>
            </select>
            <input
              v-if="form.frequency !== 'off'"
              type="time"
              class="input-field w-32"
              :aria-label="t('settings.backups.time')"
              :value="form.time"
              @change="handleTimeChange"
            />
          </div>
        </div>
        <div v-if="form.frequency !== 'off'" class="px-4 pb-3.5 -mt-1 md:px-5">
          <p class="settings-hint">
            {{ t('settings.backups.timeZone', { zone: form.timeZone }) }}
            <button
              v-if="timeZoneDiffers"
              type="button"
              class="ms-1 font-medium text-primary underline-offset-2 hover:underline"
              @click="handleUseMyTimeZone"
            >
              {{ t('settings.backups.useMyTimeZone', { zone: browserTimeZone }) }}
            </button>
          </p>
        </div>
        <div class="settings-row">
          <div class="min-w-0">
            <p class="settings-label">{{ t('settings.backups.keep') }}</p>
            <p class="settings-hint settings-prose">{{ t('settings.backups.keepHint') }}</p>
          </div>
          <input
            type="number"
            class="input-field w-24 md:ml-4"
            :min="BACKUP_KEEP_MIN"
            :max="BACKUP_KEEP_MAX"
            :aria-label="t('settings.backups.keep')"
            :value="form.keep"
            @change="handleKeepChange"
          />
        </div>
        <div class="settings-row">
          <div class="min-w-0">
            <p class="settings-label">{{ t('settings.backups.beforeUpdate') }}</p>
            <p class="settings-hint settings-prose">{{ t('settings.backups.beforeUpdateHint') }}</p>
          </div>
          <ToggleSwitch :model-value="form.beforeUpdate" class="self-start md:self-auto md:ml-4" @update:model-value="handleBeforeUpdateChange" />
        </div>
        <div v-if="form.beforeUpdate" class="settings-row">
          <div class="min-w-0">
            <p class="settings-label">{{ t('settings.backups.requireBeforeUpdate') }}</p>
            <p class="settings-hint settings-prose">{{ t('settings.backups.requireBeforeUpdateHint') }}</p>
          </div>
          <ToggleSwitch
            :model-value="form.requireBeforeUpdate"
            class="self-start md:self-auto md:ml-4"
            @update:model-value="handleRequireBeforeUpdateChange"
          />
        </div>
        <div class="flex justify-end bg-card px-4 py-3 md:px-5">
          <Button :disabled="!dirty || busy === 'save'" @click="handleSave">
            <Loader2 v-if="busy === 'save'" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {{ t('settings.backups.save') }}
          </Button>
        </div>
      </div>
    </section>

    <section aria-labelledby="backups-location-heading" class="space-y-2">
      <h2 id="backups-location-heading" class="settings-group-label">{{ t('settings.backups.location') }}</h2>
      <div class="settings-card">
        <div class="px-4 py-3.5 md:px-5 md:py-4">
          <code class="block px-3 py-2 rounded-md bg-muted text-foreground text-xs font-mono break-all select-all">{{ overview.location }}</code>
          <p class="settings-hint settings-prose mt-2">{{ t('settings.backups.contents') }}</p>
          <p class="settings-hint settings-prose mt-2">{{ t('settings.backups.sensitive') }}</p>
          <p v-if="overview.locationInsideAppData" class="mt-2 flex items-start gap-2 text-xs text-foreground settings-prose">
            <AlertTriangle class="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            <span>{{ t('settings.backups.insideAppData') }}</span>
          </p>
        </div>
      </div>
    </section>

    <section aria-labelledby="backups-list-heading" class="space-y-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="backups-list-heading" class="settings-group-label">{{ t('settings.backups.list') }}</h2>
        <div class="flex gap-2">
          <Button variant="outline" size="sm" :disabled="busy !== null" @click="handleChooseUpload">
            <Loader2 v-if="busy === 'upload'" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <Upload v-else class="size-4" aria-hidden="true" />
            {{ t('settings.backups.upload') }}
          </Button>
          <Button size="sm" :disabled="busy !== null || overview.running !== null" @click="handleCreate">
            <Loader2 v-if="busy === 'create' || overview.running" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <HardDriveDownload v-else class="size-4" aria-hidden="true" />
            {{ t('settings.backups.createNow') }}
          </Button>
          <input ref="fileInput" type="file" accept=".zip,application/zip" class="hidden" @change="handleUploadChange" />
        </div>
      </div>

      <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

      <div v-if="overview.backups.length === 0" class="settings-empty-state">
        <p class="text-sm text-muted-foreground">{{ t('settings.backups.empty') }}</p>
      </div>
      <ul v-else class="settings-card">
        <li
          v-for="backup in overview.backups"
          :key="backup.name"
          class="flex flex-col gap-2 bg-card px-4 py-3 md:flex-row md:items-center md:justify-between md:px-5"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium text-foreground">{{ formatDateTime(new Date(backup.createdAt)) }}</p>
            <p class="text-xs text-muted-foreground">
              {{ kindLabel(backup) }} · {{ formatBytes(backup.size) }} · {{ backup.appVersion }}
              <span v-if="overview.pendingRestore === backup.name" class="settings-state-pill ms-1">{{ t('settings.backups.pending') }}</span>
            </p>
          </div>
          <div class="flex shrink-0 gap-1.5">
            <Button variant="ghost" size="sm" :aria-label="t('settings.backups.download')" @click="handleDownload(backup)">
              <Download class="size-4" aria-hidden="true" />
              <span class="hidden sm:inline">{{ t('settings.backups.download') }}</span>
            </Button>
            <Button variant="ghost" size="sm" :disabled="busy !== null" :aria-label="t('settings.backups.restore')" @click="handleAskRestore(backup)">
              <ArchiveRestore class="size-4" aria-hidden="true" />
              <span class="hidden sm:inline">{{ t('settings.backups.restore') }}</span>
            </Button>
            <Button variant="ghost" size="sm" :disabled="busy !== null" :aria-label="t('settings.backups.delete')" @click="handleAskDelete(backup)">
              <Trash2 class="size-4" aria-hidden="true" />
            </Button>
          </div>
        </li>
      </ul>
    </section>
  </div>

  <ConfirmDialog
    :open="restoreTarget !== null"
    :title="t('settings.backups.restoreTitle')"
    :description="restoreTarget ? t('settings.backups.restoreBody', { date: formatDateTime(new Date(restoreTarget.createdAt)) }) : ''"
    :confirm-label="t('settings.backups.restoreConfirm')"
    confirmation-phrase="RESTORE"
    :busy="busy === 'restore'"
    destructive
    @confirm="handleConfirmRestore"
    @cancel="handleCancelRestore"
  />

  <ConfirmDialog
    :open="deleteTarget !== null"
    :title="t('settings.backups.deleteTitle')"
    :description="deleteTarget ? t('settings.backups.deleteBody', { date: formatDateTime(new Date(deleteTarget.createdAt)) }) : ''"
    :confirm-label="t('settings.backups.delete')"
    :busy="busy === 'delete'"
    destructive
    @confirm="handleConfirmDelete"
    @cancel="handleCancelDelete"
  />
</template>
