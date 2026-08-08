import { IsString, IsUUID, Length, Matches } from 'class-validator';

export class PinLoginDto {
  /** Vietnamese phone number in local format (0xxxxxxxxx) or E.164 format (+84xxxxxxxxx) */
  @IsString()
  @Matches(/^(0|\+84)[0-9]{9}$/, {
    message: 'phoneNumber must be a valid Vietnamese phone number (e.g. 0901234567 or +84901234567)',
  })
  phoneNumber!: string;

  /** 6-digit numeric PIN */
  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]{6}$/, { message: 'pin must be exactly 6 digits' })
  pin!: string;

  /** Unique UUID v4 token stored in browser localStorage */
  @IsUUID('4', { message: 'deviceToken must be a valid UUID v4' })
  deviceToken!: string;
}
