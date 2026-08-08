import { IsEnum, IsString, Matches, Length } from 'class-validator';
import { UserRole } from '../entities/user.entity';

export class CreateUserDto {
  /** Vietnamese phone number in local format (0xxxxxxxxx) or E.164 format (+84xxxxxxxxx) */
  @IsString()
  @Matches(/^(0|\+84)[0-9]{9}$/, {
    message:
      'phoneNumber must be a valid Vietnamese phone number (e.g. 0901234567 or +84901234567)',
  })
  phoneNumber!: string;
  /** Initial 6-digit numeric PIN — user must change on first login */
  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]{6}$/, { message: 'pin must be exactly 6 digits' })
  pin!: string;
  @IsEnum(UserRole) role!: UserRole;
}
