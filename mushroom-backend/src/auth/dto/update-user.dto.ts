import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { UserRole } from '../entities/user.entity';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Matches(/^(0|\+84)[0-9]{9}$/, {
    message:
      'phoneNumber must be a valid Vietnamese phone number (e.g. 0901234567 or +84901234567)',
  })
  phoneNumber?: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** Admin-initiated PIN reset — user will be required to set a new PIN on next login */
  @IsOptional()
  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]{6}$/, { message: 'newPin must be exactly 6 digits' })
  newPin?: string;
}
