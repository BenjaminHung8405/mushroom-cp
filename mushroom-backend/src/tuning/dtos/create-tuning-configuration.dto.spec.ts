import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateTuningConfigurationDto,
  TuningConfigSnapshotDto,
} from './create-tuning-configuration.dto';

const validPayload = (): CreateTuningConfigurationDto =>
  plainToInstance(CreateTuningConfigurationDto, {
    commandId: '550e8400-e29b-41d4-a716-446655440000',
    config: {
      lamp_gain_scale: 1,
      mist_gain_scale: 1,
      mist_on_threshold: 0.25,
      mist_off_threshold: 0.15,
    },
    recommendationSnapshotRef: 'advisory-2026-07-26',
  });

describe('CreateTuningConfigurationDto', () => {
  it('accepts a UUID v4 command and an in-bounds, valid config snapshot', async () => {
    expect(await validate(validPayload())).toEqual([]);
  });

  it.each([
    ['a non-v4 UUID', '550e8400-e29b-11d4-a716-446655440000'],
    ['a missing command ID', undefined],
  ])('rejects %s', async (_description, commandId) => {
    const dto = validPayload();
    dto.commandId = commandId as string;

    expect(await validate(dto)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'commandId' }),
      ]),
    );
  });

  it.each([
    ['numeric string', '1.0'],
    ['null', null],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['below hard bound', 0.79],
    ['above hard bound', 1.21],
  ])('rejects lamp gain as %s', async (_description, value) => {
    const dto = validPayload();
    dto.config.lamp_gain_scale = value as number;

    const errors = await validate(dto);
    expect(errors[0]?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'lamp_gain_scale' }),
      ]),
    );
  });

  it.each([
    ['equal thresholds', 0.2, 0.2],
    ['reversed thresholds', 0.2, 0.3],
  ])('rejects Mist hysteresis with %s', async (_description, on, off) => {
    const dto = validPayload();
    dto.config.mist_on_threshold = on;
    dto.config.mist_off_threshold = off;

    expect(await validate(dto)).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'config' })]),
    );
  });

  it('rejects a missing nested configuration field', async () => {
    const dto = validPayload();
    dto.config = plainToInstance(TuningConfigSnapshotDto, {
      lamp_gain_scale: 1,
      mist_gain_scale: 1,
      mist_on_threshold: 0.25,
    });

    const errors = await validate(dto);
    expect(errors[0]?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'mist_off_threshold' }),
      ]),
    );
  });

  it('does not expose a client-controlled requestedBy field', () => {
    expect('requestedBy' in new CreateTuningConfigurationDto()).toBe(false);
  });

  it('rejects an advisory reference longer than 255 characters', async () => {
    const dto = validPayload();
    dto.recommendationSnapshotRef = 'a'.repeat(256);

    expect(await validate(dto)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'recommendationSnapshotRef' }),
      ]),
    );
  });
});
