import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { UserRole } from '../entities/user.entity';
export class CreateUserDto { @IsEmail() email!: string; @IsString() @MinLength(16) @MaxLength(256) password!: string; @IsEnum(UserRole) role!: UserRole; }
