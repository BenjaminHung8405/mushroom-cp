import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  LAMP_GAIN_SCALE_MAX,
  LAMP_GAIN_SCALE_MIN,
  MIST_GAIN_SCALE_MAX,
  MIST_GAIN_SCALE_MIN,
  MIST_OFF_THRESHOLD_MAX,
  MIST_OFF_THRESHOLD_MIN,
  MIST_ON_THRESHOLD_MAX,
  MIST_ON_THRESHOLD_MIN,
} from '../constants/tuning-contract.constants';

const STRICT_NUMBER_OPTIONS = { allowNaN: false, allowInfinity: false };

export class TuningConfigSnapshotDto {
  @IsNumber(STRICT_NUMBER_OPTIONS)
  @Min(LAMP_GAIN_SCALE_MIN)
  @Max(LAMP_GAIN_SCALE_MAX)
  lamp_gain_scale!: number;

  @IsNumber(STRICT_NUMBER_OPTIONS)
  @Min(MIST_GAIN_SCALE_MIN)
  @Max(MIST_GAIN_SCALE_MAX)
  mist_gain_scale!: number;

  @IsNumber(STRICT_NUMBER_OPTIONS)
  @Min(MIST_ON_THRESHOLD_MIN)
  @Max(MIST_ON_THRESHOLD_MAX)
  mist_on_threshold!: number;

  @IsNumber(STRICT_NUMBER_OPTIONS)
  @Min(MIST_OFF_THRESHOLD_MIN)
  @Max(MIST_OFF_THRESHOLD_MAX)
  mist_off_threshold!: number;
}

@ValidatorConstraint({ name: 'isMistHysteresisValid', async: false })
export class IsMistHysteresisValidConstraint implements ValidatorConstraintInterface {
  validate(config: unknown): boolean {
    if (!(config instanceof TuningConfigSnapshotDto)) return false;

    const { mist_on_threshold: on, mist_off_threshold: off } = config;
    return Number.isFinite(on) && Number.isFinite(off) && off < on;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property}.mist_off_threshold must be less than ${args.property}.mist_on_threshold`;
  }
}

/** Ensures the nested Mist thresholds preserve the physical hysteresis invariant. */
export function IsMistHysteresisValid(): PropertyDecorator {
  return Validate(IsMistHysteresisValidConstraint);
}

export class CreateTuningConfigurationDto {
  /** UUID v4 idempotency key supplied by the operator client. */
  @IsUUID('4')
  commandId!: string;

  @ValidateNested()
  @Type(() => TuningConfigSnapshotDto)
  @IsMistHysteresisValid()
  config!: TuningConfigSnapshotDto;

  /** Optional opaque reference to the advisory that led to this command. */
  @IsOptional()
  @IsString()
  recommendationSnapshotRef?: string;
}
