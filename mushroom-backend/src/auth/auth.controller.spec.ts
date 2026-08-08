import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
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

  // ---------------------------------------------------------------------------
  // Device token endpoints (unchanged — legacy MQTT bootstrap)
  // ---------------------------------------------------------------------------
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

  it('GET /v1/auth/device-token should return token when X-Device-Id header is present', () => {
    const result = controller.issueDeviceToken('test_device_001');
    expect(result).toEqual({ token: 'changeme_esp32_pass' });
  });

  it('GET /v1/auth/device-token should throw BadRequestException when X-Device-Id is missing', () => {
    expect(() =>
      controller.issueDeviceToken(undefined as unknown as string),
    ).toThrow(BadRequestException);
  });

  it('PATCH /auth/profile should update profile and return public user', async () => {
    jest.spyOn(service, 'updateProfile').mockResolvedValue({
      id: 'user-1',
      phoneNumber: '+84901234567',
      fullName: 'Nguyễn Văn Nông',
      avatar: 'farmer-m',
      role: 'OPERATOR' as any,
    } as any);

    const principal: any = {
      id: 'user-1',
      phoneNumber: '+84901234567',
      role: 'OPERATOR',
      houseIds: ['house-1'],
      mustSetPin: false,
    };

    const result = await controller.updateProfile(principal, {
      fullName: 'Nguyễn Văn Nông',
      avatar: 'farmer-m',
    });

    expect(result).toEqual({
      id: 'user-1',
      phoneNumber: '+84901234567',
      fullName: 'Nguyễn Văn Nông',
      avatar: 'farmer-m',
      role: 'OPERATOR',
      houseIds: ['house-1'],
      mustSetPin: false,
    });
  });
});

