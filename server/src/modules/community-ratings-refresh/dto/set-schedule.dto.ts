import { COMMUNITY_RATINGS_REFRESH_SCHEDULES, type CommunityRatingsRefreshSchedule } from '@bookorbit/types';
import { IsIn } from 'class-validator';

export class SetCommunityRatingsRefreshScheduleDto {
  @IsIn(COMMUNITY_RATINGS_REFRESH_SCHEDULES)
  schedule!: CommunityRatingsRefreshSchedule;
}
