/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { TelemetryController } from './telemetry.controller';
import {
  TelemetryService,
  TelemetrySnapshot,
} from '../services/telemetry.service';
import { NotFoundException } from '@nestjs/common';
import { Subject } from 'rxjs';

describe('TelemetryController', () => {
  let controller: TelemetryController;
  let service: jest.Mocked<TelemetryService>;
  let telemetryUpdates$: Subject<TelemetrySnapshot>;

  const mockTelemetryService = () => {
    telemetryUpdates$ = new Subject<TelemetrySnapshot>();
    return {
      getLatestTelemetry: jest.fn(),
      getTelemetryHistory: jest.fn(),
      telemetryUpdates$,
    };
  };

  const baseSnapshot = (): TelemetrySnapshot => ({
    deviceId: 'device-1',
    houseId: 'house-1',
    time: new Date(),
    batchId: 'batch-1',
    cropDayInt: 5,
    humidityMeasured: 80,
    temperatureMeasured: 25,
    co2Measured: 600,
    humiditySetpoint: 85,
    temperatureSetpoint: 24,
    humidityErrorDelta: 5,
    temperatureErrorDelta: -1,
    mistGeneratorActive: true,
    convectionFanActive: false,
    heatingLampActive: false,
    middayBlackoutActive: false,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TelemetryController],
      providers: [
        {
          provide: TelemetryService,
          useFactory: mockTelemetryService,
        },
      ],
    }).compile();

    controller = module.get<TelemetryController>(TelemetryController);
    service = module.get(TelemetryService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getLatest', () => {
    it('should return snapshot from service if it exists', () => {
      const mockSnapshot = baseSnapshot();
      service.getLatestTelemetry.mockReturnValue(mockSnapshot);

      const result = controller.getLatest({ id: 'device-1' });
      expect(result).toBe(mockSnapshot);
      expect(service.getLatestTelemetry).toHaveBeenCalledWith('device-1');
    });

    it('should throw NotFoundException if snapshot is null', () => {
      service.getLatestTelemetry.mockReturnValue(null);

      expect(() => controller.getLatest({ id: 'device-1' })).toThrow(
        NotFoundException,
      );
    });
  });

  describe('streamTelemetry', () => {
    it('should return observable with initial seed if it exists', async () => {
      const mockSnapshot1 = baseSnapshot();
      const mockSnapshot2: TelemetrySnapshot = {
        ...mockSnapshot1,
        time: new Date(mockSnapshot1.time.getTime() + 1000),
        humidityMeasured: 82,
      };

      service.getLatestTelemetry.mockReturnValue(mockSnapshot1);

      const stream$ = controller.streamTelemetry({ id: 'device-1' });

      const eventsPromise = new Promise<any[]>((resolve) => {
        const events: any[] = [];
        const sub = stream$.subscribe({
          next: (event) => {
            events.push(event);
            if (events.length === 2) {
              sub.unsubscribe();
              resolve(events);
            }
          },
        });

        service.telemetryUpdates$.next(mockSnapshot2);
      });

      const events = await eventsPromise;
      expect(events).toEqual([
        { data: mockSnapshot1 },
        { data: mockSnapshot2 },
      ]);
    });

    it('should filter events by deviceId', async () => {
      const mockSnapshotOther: TelemetrySnapshot = {
        ...baseSnapshot(),
        deviceId: 'device-2',
        houseId: 'house-2',
      };

      const mockSnapshotMatch = baseSnapshot();

      service.getLatestTelemetry.mockReturnValue(null);

      const stream$ = controller.streamTelemetry({ id: 'device-1' });

      const eventsPromise = new Promise<any[]>((resolve) => {
        const events: any[] = [];
        const sub = stream$.subscribe({
          next: (event) => {
            events.push(event);
            if (events.length === 1) {
              sub.unsubscribe();
              resolve(events);
            }
          },
        });

        service.telemetryUpdates$.next(mockSnapshotOther);
        service.telemetryUpdates$.next(mockSnapshotMatch);
      });

      const events = await eventsPromise;
      expect(events).toEqual([{ data: mockSnapshotMatch }]);
    });
  });

  describe('getHistory', () => {
    it('should query service history and return the results', async () => {
      const from = '2026-07-10T00:00:00Z';
      const to = '2026-07-10T23:59:59Z';
      const mockHistory: TelemetrySnapshot[] = [baseSnapshot()];

      service.getTelemetryHistory.mockResolvedValue(mockHistory);

      const result = await controller.getHistory(
        { id: 'device-1' },
        { from, to },
      );
      expect(result).toBe(mockHistory);
      expect(service.getTelemetryHistory).toHaveBeenCalledWith(
        'device-1',
        new Date(from),
        new Date(to),
        undefined,
      );
    });
  });
});
