import { TuningRecommendationController } from './tuning-recommendation.controller';
import { TuningRecommendationService } from '../services/tuning-recommendation.service';
import { TuningObservationClockService } from '../services/tuning-observation-clock.service';
import { TuningRecommendationStatus } from '../entities/tuning-recommendation.entity';

describe('TuningRecommendationController', () => {
  let controller: TuningRecommendationController;
  let recommendationsService: jest.Mocked<TuningRecommendationService>;
  let clockService: jest.Mocked<TuningObservationClockService>;

  beforeEach(() => {
    recommendationsService = {
      findByDeviceAndDate: jest.fn(),
    } as any;
    clockService = {
      getCurrentObservationDate: jest.fn().mockReturnValue('2026-08-08'),
    } as any;

    controller = new TuningRecommendationController(
      recommendationsService,
      clockService,
    );
  });

  it('returns recommendation record when found', async () => {
    const mockRow: any = {
      rawKpiSnapshot: { tempRmse: 1.2 },
      currentConfigSnapshot: { lamp_gain_scale: 1 },
      advisorySnapshot: { confidence: 'HIGH' },
      blockReason: null,
      blockReasonDetail: null,
      generatedAt: new Date('2026-08-08T00:00:00.000Z'),
      status: TuningRecommendationStatus.ADVISORY,
    };
    recommendationsService.findByDeviceAndDate.mockResolvedValue(mockRow);

    const res = await controller.getTuningRecommendations('device-1');

    expect(clockService.getCurrentObservationDate).toHaveBeenCalled();
    expect(recommendationsService.findByDeviceAndDate).toHaveBeenCalledWith(
      'device-1',
      '2026-08-08',
    );
    expect(res).toMatchObject({
      deviceId: 'device-1',
      kpi: mockRow.rawKpiSnapshot,
      status: TuningRecommendationStatus.ADVISORY,
      observationDate: '2026-08-08',
    });
  });

  it('returns missing fallback response when recommendation not found', async () => {
    recommendationsService.findByDeviceAndDate.mockResolvedValue(null);

    const res = await controller.getTuningRecommendations('device-1');

    expect(res).toMatchObject({
      deviceId: 'device-1',
      kpi: null,
      currentConfig: null,
      advisory: null,
      blockReason: 'INSUFFICIENT_DATA',
      status: TuningRecommendationStatus.INSUFFICIENT_DATA,
      observationDate: '2026-08-08',
    });
  });
});
