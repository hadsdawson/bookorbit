import { NEW_RELEASE_REQUEST_FORMATS, type NewReleaseRequestFormat } from '@bookorbit/types';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn } from 'class-validator';

export class RequestReleaseDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ArrayUnique()
  @IsIn(NEW_RELEASE_REQUEST_FORMATS, { each: true })
  formats!: NewReleaseRequestFormat[];
}
