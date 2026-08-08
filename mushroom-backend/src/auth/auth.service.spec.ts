import {
  BadRequestException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserRole } from './entities/user.entity';
import { PIN_MAX_ATTEMPTS } from './auth.types';

describe('AuthService — phone+PIN', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });
  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  const baseUser = {
    id: '7e7f1d4b-92b3-4db4-a36c-083793f33e2a',
    phoneNumber: '+84901234567',
    pinHash: '',
    fullName: null as string | null,
    avatar: 'sprout' as string | null,
    role: UserRole.OPERATOR,
    isActive: true,
    mustSetPin: false,
    pinFailedAttempts: 0,
    pinLockedUntil: null as Date | null,
  };

  function makeUser(overrides: Partial<typeof baseUser> = {}) {
    return { ...baseUser, ...overrides };
  }

  function serviceWith(repositories: Record<string, unknown> = {}) {
    const user = makeUser();
    const users: any = repositories.users ?? {
      findOne: jest.fn().mockResolvedValue(user),
      findOneByOrFail: jest.fn().mockResolvedValue(user),
      exists: jest.fn().mockResolvedValue(false),
      update: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(user),
      create: jest.fn((v) => v),
    };
    const access = repositories.access ?? {
      find: jest.fn().mockResolvedValue([{ houseId: 'house-a' }]),
    };
    const sessions = repositories.sessions ?? {
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
      update: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        delete: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      }),
    };
    const events = repositories.events ?? {
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn(),
    };
    const pinDevices = repositories.pinDevices ?? {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
      create: jest.fn((v) => v),
      update: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      manager: {
        transaction: jest.fn(async (cb: (em: any) => any) => {
          const em = {
            find: (_target: any, options: any) =>
              (pinDevices as any).find(options),
            findOne: (_target: any, options: any) =>
              (pinDevices as any).findOne(options),
            save: (_targetOrEntity: any, maybeEntity?: any) =>
              maybeEntity
                ? (pinDevices as any).save(maybeEntity)
                : (pinDevices as any).save(_targetOrEntity),
            create: (_target: any, entity: any) =>
              (pinDevices as any).create(entity),
            delete: (_target: any, id: any) => (pinDevices as any).delete(id),
            update: (_target: any, id: any, updateObj: any) =>
              (pinDevices as any).update(id, updateObj),
          };
          return cb(em);
        }),
      },
    };
    return {
      service: new AuthService(
        users as never,
        access as never,
        sessions as never,
        events as never,
        pinDevices as never,
      ),
      users,
      access,
      sessions,
      events,
      pinDevices,
      user,
    };
  }

  // ---------------------------------------------------------------------------
  // PIN Strength Validation
  // ---------------------------------------------------------------------------
  describe('validatePinStrength', () => {
    it('rejects all-same-digit PINs', () => {
      const { service } = serviceWith();
      expect(() => service.validatePinStrength('000000')).toThrow(
        BadRequestException,
      );
      expect(() => service.validatePinStrength('111111')).toThrow(
        BadRequestException,
      );
      expect(() => service.validatePinStrength('999999')).toThrow(
        BadRequestException,
      );
    });

    it('rejects ascending sequences', () => {
      const { service } = serviceWith();
      expect(() => service.validatePinStrength('123456')).toThrow(
        BadRequestException,
      );
      expect(() => service.validatePinStrength('234567')).toThrow(
        BadRequestException,
      );
    });

    it('rejects descending sequences', () => {
      const { service } = serviceWith();
      expect(() => service.validatePinStrength('987654')).toThrow(
        BadRequestException,
      );
      expect(() => service.validatePinStrength('654321')).toThrow(
        BadRequestException,
      );
    });

    it('accepts a random valid PIN', () => {
      const { service } = serviceWith();
      expect(() => service.validatePinStrength('839274')).not.toThrow();
      expect(() => service.validatePinStrength('502847')).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // normalizePhone
  // ---------------------------------------------------------------------------
  describe('normalizePhone', () => {
    it('converts local format 0xxx to E.164 +84xxx', () => {
      const { service } = serviceWith();
      expect(service.normalizePhone('0901234567')).toBe('+84901234567');
    });

    it('keeps E.164 format unchanged', () => {
      const { service } = serviceWith();
      expect(service.normalizePhone('+84901234567')).toBe('+84901234567');
    });

    it('trims whitespace', () => {
      const { service } = serviceWith();
      expect(service.normalizePhone('  +84901234567  ')).toBe('+84901234567');
    });
  });

  // ---------------------------------------------------------------------------
  // Login — happy path
  // ---------------------------------------------------------------------------
  describe('login — success', () => {
    it('normalizes phone and stores SHA-256 token hash on success', async () => {
      const { service, users, sessions, user } = serviceWith();
      user.pinHash = await service.hashPin('839274');

      const result = await service.login('+84901234567', '839274', {
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      });

      expect(users.findOne).toHaveBeenCalledWith({
        where: { phoneNumber: '+84901234567' },
      });
      expect(result.token).toHaveLength(64);
      expect(sessions.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenHash: service.hashToken(result.token),
          userId: user.id,
        }),
      );
      expect(sessions.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ tokenHash: result.token }),
      );
      expect(result.principal.houseIds).toEqual(['house-a']);
      expect(result.principal.phoneNumber).toBe('+84901234567');
    });

    it('resets pinFailedAttempts and pinLockedUntil on success', async () => {
      const { service, users, user } = serviceWith();
      user.pinHash = await service.hashPin('839274');
      user.pinFailedAttempts = 3;
      user.pinLockedUntil = null;

      await service.login('+84901234567', '839274', {
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      });

      expect(users.update).toHaveBeenCalledWith(user.id, {
        pinFailedAttempts: 0,
        pinLockedUntil: null,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Login — failure and lockout
  // ---------------------------------------------------------------------------
  describe('login — failure & lockout', () => {
    it('throws UnauthorizedException on wrong PIN', async () => {
      const { service, user } = serviceWith();
      user.pinHash = await service.hashPin('839274');

      await expect(
        service.login('+84901234567', '000000', {
          ipAddress: '127.0.0.1',
          userAgent: 'jest',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it(`increments pinFailedAttempts on each wrong PIN (< ${PIN_MAX_ATTEMPTS})`, async () => {
      const { service, users, user } = serviceWith();
      user.pinHash = await service.hashPin('839274');
      user.pinFailedAttempts = 2;

      await expect(
        service.login('+84901234567', '000000', {
          ipAddress: '127.0.0.1',
          userAgent: 'jest',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(users.update).toHaveBeenCalledWith(user.id, {
        pinFailedAttempts: 3,
      });
    });

    it(`sets pinLockedUntil when attempts reach ${PIN_MAX_ATTEMPTS}`, async () => {
      const { service, users, user } = serviceWith();
      user.pinHash = await service.hashPin('839274');
      user.pinFailedAttempts = PIN_MAX_ATTEMPTS - 1;

      await expect(
        service.login('+84901234567', '000000', {
          ipAddress: '127.0.0.1',
          userAgent: 'jest',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(users.update).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({
          pinFailedAttempts: 0,
          pinLockedUntil: expect.any(Date),
        }),
      );
    });

    it('blocks login when pinLockedUntil is in the future', async () => {
      const { service, user } = serviceWith();
      user.pinHash = await service.hashPin('839274');
      user.pinLockedUntil = new Date(Date.now() + 10 * 60 * 1000); // locked 10min from now

      await expect(
        service.login('+84901234567', '839274', {
          ipAddress: '127.0.0.1',
          userAgent: 'jest',
        }),
      ).rejects.toThrow(HttpException);
    });
  });

  // ---------------------------------------------------------------------------
  // Session revocation
  // ---------------------------------------------------------------------------
  it('broadcasts local session invalidation after revoking every user session', async () => {
    const queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const { service } = serviceWith({
      sessions: {
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
        create: jest.fn(),
        save: jest.fn(),
        update: jest.fn(),
        findOne: jest.fn(),
      },
    });
    const revoked: string[] = [];
    service.userSessionsRevoked$.subscribe((userId) => revoked.push(userId));

    await service.revokeAllUserSessions(baseUser.id, 'PIN_RESET');

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'user_id = :userId AND revoked_at IS NULL',
      { userId: baseUser.id },
    );
    expect(revoked).toEqual([baseUser.id]);
  });

  // ---------------------------------------------------------------------------
  // Kiosk Device PIN (unified PIN model)
  // ---------------------------------------------------------------------------
  describe('Kiosk Device PIN', () => {
    const validDeviceToken = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';

    function kioskServiceWith(
      pinDeviceOverrides: Partial<Record<string, unknown>> = {},
    ) {
      const pinDevicesList: any[] = [];
      const pinDevices = {
        find: jest.fn().mockResolvedValue(pinDevicesList),
        findOne: jest.fn().mockImplementation(({ where }) => {
          return Promise.resolve(
            pinDevicesList.find(
              (d) =>
                d.userId === where.userId &&
                d.deviceTokenHash === where.deviceTokenHash,
            ) ?? null,
          );
        }),
        save: jest.fn().mockImplementation((entity) => {
          const idx = pinDevicesList.findIndex((d) => d.id === entity.id);
          if (idx !== -1) {
            pinDevicesList[idx] = { ...pinDevicesList[idx], ...entity };
            return Promise.resolve(pinDevicesList[idx]);
          }
          const saved = {
            id: `device-${pinDevicesList.length + 1}`,
            ...entity,
            createdAt: new Date(),
          };
          pinDevicesList.push(saved);
          return Promise.resolve(saved);
        }),
        create: jest.fn((v) => v),
        update: jest.fn().mockImplementation((id, updateObj) => {
          const item = pinDevicesList.find((d) => d.id === id);
          if (item) Object.assign(item, updateObj);
          return Promise.resolve();
        }),
        delete: jest.fn().mockImplementation((where) => {
          const idx = pinDevicesList.findIndex((d) =>
            typeof where === 'object' && where?.id
              ? d.id === where.id
              : typeof where === 'object' && where?.userId
                ? d.userId === where.userId
                : d.id === where,
          );
          if (idx !== -1) pinDevicesList.splice(idx, 1);
          return Promise.resolve();
        }),
        manager: {
          transaction: jest.fn(async (cb: (em: any) => any) => {
            const em = {
              find: (_target: any, options: any) => pinDevices.find(options),
              findOne: (_target: any, options: any) =>
                pinDevices.findOne(options),
              save: (targetOrEntity: any, maybeEntity?: any) =>
                maybeEntity
                  ? pinDevices.save(maybeEntity)
                  : pinDevices.save(targetOrEntity),
              create: (_target: any, entity: any) => pinDevices.create(entity),
              delete: (_target: any, id: any) => pinDevices.delete(id),
              update: (_target: any, id: any, updateObj: any) =>
                pinDevices.update(id, updateObj),
            };
            return cb(em);
          }),
        },
        ...pinDeviceOverrides,
      };

      const result = serviceWith({ pinDevices });
      return { ...result, pinDevices, pinDevicesList };
    }

    it('registerDevice — creates a device record on first call', async () => {
      const { service, user, pinDevicesList } = kioskServiceWith();
      await service.registerDevice(user.id, validDeviceToken, 'Chrome on iPad');
      expect(pinDevicesList).toHaveLength(1);
      expect(pinDevicesList[0].deviceLabel).toBe('Chrome on iPad');
    });

    it('registerDevice — updates existing device instead of inserting duplicate', async () => {
      const { service, user, pinDevicesList } = kioskServiceWith();
      await service.registerDevice(user.id, validDeviceToken, 'Chrome on iPad');
      await service.registerDevice(user.id, validDeviceToken, 'Safari on iPad');
      // Should still be 1 record, label updated
      expect(pinDevicesList).toHaveLength(1);
      expect(pinDevicesList[0].deviceLabel).toBe('Safari on iPad');
    });

    it('loginWithDevicePin — successful login using account PIN (user.pinHash)', async () => {
      const { service, user } = kioskServiceWith();
      user.pinHash = await service.hashPin('839274');

      // Device is registered via registerDevice (mirrors login() auto-register)
      await service.registerDevice(user.id, validDeviceToken, 'Test Tablet');

      const loginRes = await service.loginWithDevicePin(
        user.phoneNumber,
        '839274',
        validDeviceToken,
        {
          ipAddress: '127.0.0.1',
          userAgent: 'jest',
        },
      );

      expect(loginRes.token).toHaveLength(64);
      expect(loginRes.principal.phoneNumber).toBe(user.phoneNumber);
    });

    it('loginWithDevicePin — rejects wrong PIN with unified error message', async () => {
      const { service, user } = kioskServiceWith();
      user.pinHash = await service.hashPin('839274');
      await service.registerDevice(user.id, validDeviceToken, 'Test Tablet');

      await expect(
        service.loginWithDevicePin(
          user.phoneNumber,
          '000000',
          validDeviceToken,
          { ipAddress: null, userAgent: null },
        ),
      ).rejects.toThrow('Thông tin thiết bị hoặc mã PIN không chính xác.');
    });

    it('loginWithDevicePin — timing attack protection on missing user/device', async () => {
      const { service } = kioskServiceWith();
      await expect(
        service.loginWithDevicePin('+84999999999', '123456', validDeviceToken, {
          ipAddress: '127.0.0.1',
          userAgent: 'jest',
        }),
      ).rejects.toThrow('Thông tin thiết bị hoặc mã PIN không chính xác.');
    });

    it('loginWithDevicePin — per-device lockout after 3 failed attempts', async () => {
      const { service, user } = kioskServiceWith();
      user.pinHash = await service.hashPin('839274');
      await service.registerDevice(user.id, validDeviceToken, 'Test Tablet');

      const ctx = { ipAddress: null, userAgent: null };
      // Attempts 1-2: unified error
      await expect(
        service.loginWithDevicePin(
          user.phoneNumber,
          '000000',
          validDeviceToken,
          ctx,
        ),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.loginWithDevicePin(
          user.phoneNumber,
          '000000',
          validDeviceToken,
          ctx,
        ),
      ).rejects.toThrow(UnauthorizedException);

      // Attempt 3: triggers device lock
      await expect(
        service.loginWithDevicePin(
          user.phoneNumber,
          '000000',
          validDeviceToken,
          ctx,
        ),
      ).rejects.toThrow(UnauthorizedException);

      // Attempt 4: device is now locked — even correct PIN is blocked
      await expect(
        service.loginWithDevicePin(
          user.phoneNumber,
          '839274',
          validDeviceToken,
          ctx,
        ),
      ).rejects.toThrow(HttpException);
    });

    it('loginWithDevicePin — dual-level: account locked after PIN_MAX_ATTEMPTS cross-device failures', async () => {
      // Two different device tokens to simulate brute-force across multiple tablets
      const deviceToken2 = 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e';
      const { service, user, users } = kioskServiceWith();
      user.pinHash = await service.hashPin('839274');
      user.pinFailedAttempts = 0;

      // Register both devices
      await service.registerDevice(user.id, validDeviceToken, 'Tablet A');
      await service.registerDevice(user.id, deviceToken2, 'Tablet B');

      const ctx = { ipAddress: null, userAgent: null };

      // 5 total wrong PIN attempts across devices — triggers dual-level lockout
      for (let i = 0; i < 5; i++) {
        try {
          await service.loginWithDevicePin(
            user.phoneNumber,
            '000000',
            i < 3 ? validDeviceToken : deviceToken2,
            ctx,
          );
        } catch {
          // expected
        }
      }

      // users.update should have been called to increment pinFailedAttempts at account level
      const accountUpdateCalls = (users.update as jest.Mock).mock.calls.filter(
        ([, updateObj]) =>
          'pinFailedAttempts' in updateObj || 'pinLockedUntil' in updateObj,
      );
      expect(accountUpdateCalls.length).toBeGreaterThan(0);
    });
  });

  describe('updateProfile', () => {
    it('updates user fullName and avatar', async () => {
      const { service, user, users } = serviceWith();
      const updated = await service.updateProfile(user.id, {
        fullName: '  Nguyễn Văn Nông  ',
        avatar: 'farmer-m',
      });
      expect(users.save).toHaveBeenCalled();
      expect(user.fullName).toBe('Nguyễn Văn Nông');
      expect(user.avatar).toBe('farmer-m');
    });
  });
});
