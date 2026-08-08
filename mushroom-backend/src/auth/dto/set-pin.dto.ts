import { IsString, Matches, Length } from 'class-validator';

export class SetPinDto {
  /** Current 6-digit PIN for verification */
  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]{6}$/, { message: 'currentPin must be exactly 6 digits' })
  currentPin!: string;
  /** New 6-digit PIN — must not be a simple sequence */
  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]{6}$/, { message: 'newPin must be exactly 6 digits' })
  newPin!: string;
}
