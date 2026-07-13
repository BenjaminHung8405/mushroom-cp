import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateCheckpointsDto, MetricType } from './update-checkpoints.dto';

describe('UpdateCheckpointsDto', () => {
  it('should validate a correct dto', async () => {
    const data = {
      checkpoints: [
        {
          metricType: MetricType.TEMPERATURE,
          cropDay: 5,
          targetValue: 25.5,
        },
        {
          metricType: MetricType.HUMIDITY,
          cropDay: 10,
          targetValue: 80,
        },
      ],
    };

    const dto = plainToInstance(UpdateCheckpointsDto, data);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should reject invalid cropDay values', async () => {
    const data = {
      checkpoints: [
        {
          metricType: MetricType.TEMPERATURE,
          cropDay: 0, // invalid: min is 1
          targetValue: 25.5,
        },
        {
          metricType: MetricType.HUMIDITY,
          cropDay: 46, // invalid: max is 45
          targetValue: 80,
        },
      ],
    };

    const dto = plainToInstance(UpdateCheckpointsDto, data);
    const errors = await validate(dto);
    expect(errors.length).toBe(1);
    const checkpointErrors = await validate(dto.checkpoints[0]);
    expect(checkpointErrors.length).toBe(1);
  });

  it('should reject invalid targetValue values', async () => {
    const data = {
      checkpoints: [
        {
          metricType: MetricType.TEMPERATURE,
          cropDay: 5,
          targetValue: -1, // invalid: min is 0
        },
        {
          metricType: MetricType.HUMIDITY,
          cropDay: 10,
          targetValue: 101, // invalid: max is 100
        },
      ],
    };

    const dto = plainToInstance(UpdateCheckpointsDto, data);
    const checkpointErrors0 = await validate(dto.checkpoints[0]);
    expect(checkpointErrors0.length).toBe(1);
    const checkpointErrors1 = await validate(dto.checkpoints[1]);
    expect(checkpointErrors1.length).toBe(1);
  });

  it('should reject invalid metricType', async () => {
    const data = {
      checkpoints: [
        {
          metricType: 'INVALID' as any,
          cropDay: 5,
          targetValue: 25.5,
        },
      ],
    };

    const dto = plainToInstance(UpdateCheckpointsDto, data);
    const checkpointErrors = await validate(dto.checkpoints[0]);
    expect(checkpointErrors.length).toBe(1);
  });
});
