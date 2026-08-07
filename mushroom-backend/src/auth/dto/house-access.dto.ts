import { ArrayMaxSize, ArrayUnique, IsArray, IsString, Matches } from 'class-validator';
export class HouseAccessDto { @IsArray() @ArrayUnique() @ArrayMaxSize(500) @IsString({ each: true }) @Matches(/^[a-zA-Z0-9_-]+$/, { each: true }) houseIds!: string[]; }
