import { IsString, MinLength, MaxLength } from 'class-validator';
export class ChangePasswordDto {
  @IsString() @MinLength(8) @MaxLength(256) currentPassword!: string;
  @IsString() @MinLength(16) @MaxLength(256) newPassword!: string;
}
