import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { AnalyticsAvailabilityService } from './influx/services/analytics-availability.service';
import { Public } from './security/public.decorator';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly analyticsAvailability: AnalyticsAvailabilityService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @Public()
  getHealth(): object {
    const analytics = this.analyticsAvailability.getState();
    return {
      status: analytics.available ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      analytics,
    };
  }
}
