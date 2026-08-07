import { IsBoolean, IsEmail, IsEnum, IsOptional } from 'class-validator';
import { UserRole } from '../entities/user.entity';
export class UpdateUserDto { @IsOptional() @IsEmail() email?: string; @IsOptional() @IsEnum(UserRole) role?: UserRole; @IsOptional() @IsBoolean() isActive?: boolean; }
