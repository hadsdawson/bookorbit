import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RelocateLibraryFolderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  newPath!: string;
}
