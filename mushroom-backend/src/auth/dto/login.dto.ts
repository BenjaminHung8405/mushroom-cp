import { IsString, Matches, Length } from 'class-validator';

export class LoginDto {
  /** Vietnamese phone number in E.164 format: +84 followed by 9 digits */
  @IsString() @Matches(/^\+84[0-9]{9}$/, { message: 'phoneNumber must be a valid Vietnamese phone number in E.164 format (e.g. +84901234567)' }) phoneNumber!: string;
  /** 6-digit numeric PIN */
  @IsString() @Length(6, 6) @Matches(/^[0-9]{6}$/, { message: 'pin must be exactly 6 digits' }) pin!: string;
}

