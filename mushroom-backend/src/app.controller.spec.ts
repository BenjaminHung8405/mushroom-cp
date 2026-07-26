import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AnalyticsAvailabilityService } from './influx/services/analytics-availability.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: AnalyticsAvailabilityService,
          useValue: {
            getState: jest.fn(() => ({
              available: false,
              reason: 'INFLUX_ANALYTICS_NOT_READY',
            })),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  it('reports degraded analytics readiness without making the process unhealthy', () => {
    expect(appController.getHealth()).toMatchObject({
      status: 'degraded',
      analytics: {
        available: false,
        reason: 'INFLUX_ANALYTICS_NOT_READY',
      },
    });
  });
});
