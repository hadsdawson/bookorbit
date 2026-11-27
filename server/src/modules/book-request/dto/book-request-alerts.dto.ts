import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { MAX_BOOK_REQUEST_ALERT_EMAILS } from '@bookorbit/types';

export class UpdateBookRequestAlertSettingsDto {
  @IsOptional()
  @IsBoolean()
  discordEnabled?: boolean;

  /** Null removes the saved webhook; omitted keeps it. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  discordWebhookUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_BOOK_REQUEST_ALERT_EMAILS)
  @IsEmail({}, { each: true, message: 'Each alert address must be a valid email address' })
  emailTo?: string[];

  @IsOptional()
  @IsBoolean()
  includeAdminRequests?: boolean;
}
