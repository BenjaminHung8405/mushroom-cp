import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserRole } from './entities/user.entity';
import { PIN_MAX_ATTEMPTS } from './auth.types';

describe('AuthService — phone+PIN', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  beforeEach(() => { process.env.NODE_ENV = 'test'; });
  afterAll(() => { process.env.NODE_ENV = originalNodeEnv; });

  const baseUser = {
    id: '7e7f1d4b-92b3-4db4-a36c-083793f33e2a',
    phoneNumber: '+84901234567',
    pinHash: '',
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
    const users = repositories.users ?? {
      findOne: jest.fn().mockResolvedValue(user),
      findOneByOrFail: jest.fn().mockResolvedValue(user),
      exists: jest.fn().mockResolvedValue(false),
      update: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(user),
      create: jest.fn((v) => v),
    };
    const access = repositories.access ?? { find: jest.fn().mockResolvedValue([{ houseId: 'house-a' }]) };
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
    return { service: new AuthService(users as never, access as never, sessions as never, events as never), users, access, sessions, events, user };
  }

  // ---------------------------------------------------------------------------
  // PIN Strength Validation
  // ---------------------------------------------------------------------------
  describe('validatePinStrength', () => {
    it('rejects all-same-digit PINs', () => {
      const { service } = serviceWith();
      expect(() => service.validatePinStrength('000000')).toThrow(BadRequestException);
      expect(() => service.validatePinStrength('111111')).toThrow(BadRequestException);
      expect(() => service.validatePinStrength('999999')).toThrow(BadRequestException);
    });

    it('rejects ascending sequences', () => {
      const { service } = serviceWith();
      expect(() => service.validatePinStrength('123456')).toThrow(BadRequestException);
      expect(() => service.validatePinStrength('234567')).toThrow(BadRequestException);
    });

    it('rejects descending sequences', () => {
      const { service } = serviceWith();
      expect(() => service.validatePinStrength('987654')).toThrow(BadRequestException);
      expect(() => service.validatePinStrength('654321')).toThrow(BadRequestException);
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

      const result = await service.login('+84901234567', '839274', { ipAddress: '127.0.0.1', userAgent: 'jest' });

      expect(users.findOne).toHaveBeenCalledWith({ where: { phoneNumber: '+84901234567' } });
      expect(result.token).toHaveLength(64);
      expect(sessions.save).toHaveBeenCalledWith(expect.objectContaining({
        tokenHash: service.hashToken(result.token),
        userId: user.id,
      }));
      expect(sessions.save).not.toHaveBeenCalledWith(expect.objectContaining({ tokenHash: result.token }));
      expect(result.principal.houseIds).toEqual(['house-a']);
      expect(result.principal.phoneNumber).toBe('+84901234567');
    });

    it('resets pinFailedAttempts and pinLockedUntil on success', async () => {
      const { service, users, user } = serviceWith();
      user.pinHash = await service.hashPin('839274');
      user.pinFailedAttempts = 3;
      user.pinLockedUntil = null;

      await service.login('+84901234567', '839274', { ipAddress: '127.0.0.1', userAgent: 'jest' });

      expect(users.update).toHaveBeenCalledWith(user.id, { pinFailedAttempts: 0, pinLockedUntil: null });
    });
  });

  // ---------------------------------------------------------------------------
  // Login — failure and lockout
  // ---------------------------------------------------------------------------
  describe('login — failure & lockout', () => {
    it('throws UnauthorizedException on wrong PIN', async () => {
      const { service, user } = serviceWith();
      user.pinHash = await service.hashPin('839274');

      await expect(service.login('+84901234567', '000000', { ipAddress: '127.0.0.1', userAgent: 'jest' }))
        .rejects.toThrow(UnauthorizedException);
    });

    it(`increments pinFailedAttempts on each wrong PIN (< ${PIN_MAX_ATTEMPTS})`, async () => {
      const { service, users, user } = serviceWith();
      user.pinHash = await service.hashPin('839274');
      user.pinFailedAttempts = 2;

      await expect(service.login('+84901234567', '000000', { ipAddress: '127.0.0.1', userAgent: 'jest' }))
        .rejects.toThrow(UnauthorizedException);

      expect(users.update).toHaveBeenCalledWith(user.id, { pinFailedAttempts: 3 });
    });

    it(`sets pinLockedUntil when attempts reach ${PIN_MAX_ATTEMPTS}`, async () => {
      const { service, users, user } = serviceWith();
      user.pinHash = await service.hashPin('839274');
      user.pinFailedAttempts = PIN_MAX_ATTEMPTS - 1;

      await expect(service.login('+84901234567', '000000', { ipAddress: '127.0.0.1', userAgent: 'jest' }))
        .rejects.toThrow(UnauthorizedException);

      expect(users.update).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({ pinFailedAttempts: 0, pinLockedUntil: expect.any(Date) }),
      );
    });

    it('blocks login when pinLockedUntil is in the future', async () => {
      const { service, user } = serviceWith();
      user.pinHash = await service.hashPin('839274');
      user.pinLockedUntil = new Date(Date.now() + 10 * 60 * 1000); // locked 10min from now

      await expect(service.login('+84901234567', '839274', { ipAddress: '127.0.0.1', userAgent: 'jest' }))
        .rejects.toThrow(HttpException);
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

    expect(queryBuilder.where).toHaveBeenCalledWith('user_id = :userId AND revoked_at IS NULL', { userId: baseUser.id });
    expect(revoked).toEqual([baseUser.id]);
  });
});
