import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class PinSetupDto {
  /** 6-digit numeric PIN currently set on the user's account */
  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]{6}$/, { message: 'currentPin must be exactly 6 digits' })
  currentPin!: string;

  /** 6-digit numeric PIN to bind to this device */
  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]{6}$/, { message: 'newPinForDevice must be exactly 6 digits' })
  newPinForDevice!: string;

  /** Unique UUID v4 token stored in browser localStorage */
  @IsUUID('4', { message: 'deviceToken must be a valid UUID v4' })
  deviceToken!: string;

  /** Optional descriptive label for the tablet device */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  deviceLabel?: string;
}
