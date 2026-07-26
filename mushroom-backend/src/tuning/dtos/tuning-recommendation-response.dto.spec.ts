import {
  TuningRecommendationResponseDto,
  type TuningRecommendationBlockReason,
} from './tuning-recommendation-response.dto';

describe('TuningRecommendationResponseDto', () => {
  it('models a blocked response without fabricating KPI, config, or advisory data', () => {
    const response: TuningRecommendationResponseDto = {
      deviceId: 'device-001',
      kpi: null,
      currentConfig: null,
      advisory: null,
      blockReason: 'DEVICE_OFFLINE',
      blockReasonDetail:
        'No telemetry has been received in the last five minutes.',
      generatedAt: '2026-07-26T06:00:00.000Z',
    };

    expect(response).toEqual({
      deviceId: 'device-001',
      kpi: null,
      currentConfig: null,
      advisory: null,
      blockReason: 'DEVICE_OFFLINE',
      blockReasonDetail:
        'No telemetry has been received in the last five minutes.',
      generatedAt: '2026-07-26T06:00:00.000Z',
    });
  });

  it.each<TuningRecommendationBlockReason>([
    'INSUFFICIENT_DATA',
    'DEVICE_OFFLINE',
    'NO_SUGGESTION',
    'CONFLICT',
  ])('permits the stable public block reason %s', (blockReason) => {
    const response: Pick<TuningRecommendationResponseDto, 'blockReason'> = {
      blockReason,
    };

    expect(response.blockReason).toBe(blockReason);
  });
});
