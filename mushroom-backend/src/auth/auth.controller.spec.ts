import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let service: AuthService;

  beforeEach(async () => {
    process.env.MQTT_ESP32_PASS = 'changeme_esp32_pass';

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [AuthService],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    delete process.env.MQTT_ESP32_PASS;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
    expect(service).toBeDefined();
  });

  it('POST /auth/token should return token from MQTT_ESP32_PASS', () => {
    const result = controller.issueToken({
      clientId: 'esp32_mushroom_client',
      mqttUser: 'esp32_mushroom_client',
    });

    expect(result).toEqual({ token: 'changeme_esp32_pass' });
  });

  it('should throw when MQTT_ESP32_PASS is missing', () => {
    delete process.env.MQTT_ESP32_PASS;

    expect(() =>
      controller.issueToken({
        clientId: 'esp32_mushroom_client',
      }),
    ).toThrow(ServiceUnavailableException);
  });
});
