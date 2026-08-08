import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { Module, Global } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TuningModule } from './tuning.module';
import { TuningConfigurationService } from './services/tuning-configuration.service';
import { DeviceTuningConfiguration } from './entities/device-tuning-configuration.entity';
import { TuningAuditLog } from './entities/tuning-audit-log.entity';
import { TuningMqttOutbox } from './entities/tuning-mqtt-outbox.entity';
import { TuningRecommendation } from './entities/tuning-recommendation.entity';
import { MqttModule } from '../mqtt/mqtt.module';
import { MqttService } from '../mqtt/mqtt.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ControlAnalyticsService } from '../analytics/services/control-analytics.service';
import { TuningRecommenderEngine } from '../analytics/services/tuning-recommender-engine.service';
import { DeviceModule } from '../device/device.module';
import { DEVICES_SERVICE } from '../device/devices.service';
import { AnalyticsAvailabilityService } from '../influx/services/analytics-availability.service';
import { InfluxModule } from '../influx/influx.module';

describe('TuningModule', () => {
  let mockDataSource: unknown;
  let mockConfigRepo: unknown;
  let mockAuditRepo: unknown;
  let mockMqttService: unknown;
  let mockOutboxRepo: unknown;
  let mockRecommendationRepo: unknown;

  beforeEach(() => {
    process.env.TUNING_SSE_TICKET_SECRET = 't'.repeat(32);
    mockDataSource = {
      transaction: jest.fn(),
      query: jest.fn(),
    };
    mockConfigRepo = {
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };
    mockAuditRepo = {
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };
    mockMqttService = {
      publishTuningDesired: jest.fn(),
    };
    mockOutboxRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };
    mockRecommendationRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };
  });

  it('should compile TuningModule and provide TuningConfigurationService', async () => {
    @Global()
    @Module({
      providers: [
        {
          provide: MqttService,
          useValue: mockMqttService,
        },
      ],
      exports: [MqttService],
    })
    class MockMqttModule {}

    @Global()
    @Module({
      providers: [
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: getDataSourceToken(),
          useValue: mockDataSource,
        },
      ],
      exports: [DataSource, getDataSourceToken()],
    })
    class MockDatabaseModule {}

    @Global()
    @Module({
      providers: [
        { provide: ControlAnalyticsService, useValue: {} },
        { provide: TuningRecommenderEngine, useValue: {} },
        {
          provide: AnalyticsAvailabilityService,
          useValue: { getState: jest.fn(() => ({ available: true })) },
        },
      ],
      exports: [
        ControlAnalyticsService,
        TuningRecommenderEngine,
        AnalyticsAvailabilityService,
      ],
    })
    class MockAnalyticsModule {}

    @Global()
    @Module({
      providers: [
        {
          provide: AnalyticsAvailabilityService,
          useValue: { getState: jest.fn(() => ({ available: true })) },
        },
      ],
      exports: [AnalyticsAvailabilityService],
    })
    class MockInfluxModule {}

    @Global()
    @Module({
      providers: [
        {
          provide: DEVICES_SERVICE,
          useValue: { isDeviceOwnedByUser: jest.fn() },
        },
      ],
      exports: [DEVICES_SERVICE],
    })
    class MockDeviceModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TuningModule, MockDatabaseModule],
    })
      .overrideModule(MqttModule)
      .useModule(MockMqttModule)
      .overrideModule(AnalyticsModule)
      .useModule(MockAnalyticsModule)
      .overrideModule(InfluxModule)
      .useModule(MockInfluxModule)
      .overrideModule(DeviceModule)
      .useModule(MockDeviceModule)
      .overrideProvider(getRepositoryToken(DeviceTuningConfiguration))
      .useValue(mockConfigRepo)
      .overrideProvider(getRepositoryToken(TuningAuditLog))
      .useValue(mockAuditRepo)
      .overrideProvider(getRepositoryToken(TuningMqttOutbox))
      .useValue(mockOutboxRepo)
      .overrideProvider(getRepositoryToken(TuningRecommendation))
      .useValue(mockRecommendationRepo)
      .compile();

    expect(moduleRef).toBeDefined();

    const tuningService = moduleRef.get<TuningConfigurationService>(
      TuningConfigurationService,
    );
    expect(tuningService).toBeDefined();
    expect(tuningService).toBeInstanceOf(TuningConfigurationService);
  });
});
