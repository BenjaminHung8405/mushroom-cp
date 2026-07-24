import { IsNumber, IsString, Matches, Max, Min } from 'class-validator';
import {
  LAMP_GAIN_SCALE_MAX, LAMP_GAIN_SCALE_MIN, MIST_GAIN_SCALE_MAX, MIST_GAIN_SCALE_MIN,
  MIST_OFF_THRESHOLD_MAX, MIST_OFF_THRESHOLD_MIN, MIST_ON_THRESHOLD_MAX, MIST_ON_THRESHOLD_MIN,
} from '../constants/tuning-contract.constants';

export class CreateTuningCommandDto {
  @IsString() @Matches(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i) commandId: string;
  @IsNumber() @Min(LAMP_GAIN_SCALE_MIN) @Max(LAMP_GAIN_SCALE_MAX) lamp_gain_scale: number;
  @IsNumber() @Min(MIST_GAIN_SCALE_MIN) @Max(MIST_GAIN_SCALE_MAX) mist_gain_scale: number;
  @IsNumber() @Min(MIST_ON_THRESHOLD_MIN) @Max(MIST_ON_THRESHOLD_MAX) mist_on_threshold: number;
  @IsNumber() @Min(MIST_OFF_THRESHOLD_MIN) @Max(MIST_OFF_THRESHOLD_MAX) mist_off_threshold: number;
}
