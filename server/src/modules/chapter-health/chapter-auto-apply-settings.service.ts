import { ForbiddenException, Injectable } from '@nestjs/common';
import { CHAPTER_RUNTIME_TOLERANCE, Permission, type ChapterAutoApplySettings } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { AppSettingsService } from '../app-settings/app-settings.service';

export const RUNTIME_TOLERANCE_KEY = 'chapter_lookup_runtime_tolerance_seconds';

/** The runtime tolerance for applying Audible chapters with nobody looking; one value for the whole server. */
@Injectable()
export class ChapterAutoApplySettingsService {
  constructor(private readonly appSettings: AppSettingsService) {}

  async runtimeToleranceSeconds(): Promise<number> {
    return parseTolerance(await this.appSettings.getValue(RUNTIME_TOLERANCE_KEY));
  }

  async runtimeToleranceMs(): Promise<number> {
    return (await this.runtimeToleranceSeconds()) * 1000;
  }

  async get(user: RequestUser): Promise<ChapterAutoApplySettings> {
    return { runtimeToleranceSeconds: await this.runtimeToleranceSeconds(), canEdit: canEdit(user) };
  }

  async update(user: RequestUser, runtimeToleranceSeconds: number): Promise<ChapterAutoApplySettings> {
    if (!canEdit(user)) throw new ForbiddenException('Changing this needs the App settings permission');
    await this.appSettings.setValue(RUNTIME_TOLERANCE_KEY, String(parseTolerance(String(runtimeToleranceSeconds))));
    return this.get(user);
  }
}

function canEdit(user: RequestUser): boolean {
  return user.isSuperuser || user.permissions.includes(Permission.ManageAppSettings);
}

export function parseTolerance(raw: string | null): number {
  const value = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(value)) return CHAPTER_RUNTIME_TOLERANCE.defaultSeconds;
  return Math.min(CHAPTER_RUNTIME_TOLERANCE.maxSeconds, Math.max(CHAPTER_RUNTIME_TOLERANCE.minSeconds, Math.round(value * 10) / 10));
}
