import { Test } from '@nestjs/testing';
import { Module } from '@nestjs/common';
import { InfluxModule } from './influx.module';
import { ConfigService } from './services/config.service';
import { InfluxDbService } from './services/influx-db.service';
import { ControlHistoryInfluxWriter } from './services/control-history-influx-writer.service';
import { MqttModule } from '../mqtt/mqtt.module';
import { MqttService } from '../mqtt/mqtt.service';
import { Subject } from 'rxjs';

describe('InfluxModule', () => {
  let mockInfluxDbService: any;
  let mockConfigService: any;
  let mockMqttService: any;
  let mockWriteApi: any;

  beforeEach(() => {
    mockWriteApi = {
      writePoint: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };

    mockInfluxDbService = {
      getWriteApi: jest.fn().mockReturnValue(mockWriteApi),
    };

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'INFLUXDB_BUCKET') return 'test_bucket';
        return undefined;
      }),
    };

    mockMqttService = {
      telemetry$: new Subject().asObservable(),
    };
  });

  it('should compile the module and instantiate services', async () => {
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

    const moduleRef = await Test.createTestingModule({
      imports: [InfluxModule],
    })
      .overrideModule(MqttModule)
      .useModule(MockMqttModule)
      .overrideProvider(InfluxDbService)
      .useValue(mockInfluxDbService)
      .overrideProvider(ConfigService)
      .useValue(mockConfigService)
      .compile();

    expect(moduleRef).toBeDefined();

    // Verify services can be retrieved
    const influxDbService = moduleRef.get<InfluxDbService>(InfluxDbService);
    const configService = moduleRef.get<ConfigService>(ConfigService);
    const controlHistoryWriter = moduleRef.get<ControlHistoryInfluxWriter>(ControlHistoryInfluxWriter);

    expect(influxDbService).toBeDefined();
    expect(configService).toBeDefined();
    expect(controlHistoryWriter).toBeDefined();
  });
});
