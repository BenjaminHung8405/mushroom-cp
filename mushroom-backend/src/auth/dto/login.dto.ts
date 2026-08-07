import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
export class LoginDto { @IsEmail() email!: string; @IsString() @MinLength(8) @MaxLength(256) password!: string; }
