import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { Cron } from '@nestjs/schedule';
import { createClient, type RedisClientType } from 'redis';
import { IsNull, LessThan, Repository } from 'typeorm';
import { Subject } from 'rxjs';
import { AuthSecurityEvent } from './entities/auth-security-event.entity';
import { AuthSession } from './entities/auth-session.entity';
import { User, UserRole } from './entities/user.entity';
import { UserHouseAccess } from './entities/user-house-access.entity';
import {
  AuthPrincipal,
  PIN_LOCKOUT_MS,
  PIN_MAX_ATTEMPTS,
  SESSION_IDLE_MS,
  SESSION_MAX_AGE_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from './auth.types';

/**
 * Dummy PIN hash used for constant-time comparison when the phone number
 * does not exist — prevents user enumeration via timing attacks.
 */
const DUMMY_PIN_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHRmb3J0ZXN0$MKh8fFXo6P1jqKnAjglmr1nCIWFYtrIvzm0TTTTW06I';

const LOGIN_PHONE_LIMIT = 8;
const LOGIN_IP_LIMIT = 40;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const SESSION_REVOKE_CHANNEL = 'mushroom:auth:session-revoked';

/**
 * Weak PIN patterns that farmers commonly choose.
 * All sequences are for a 6-digit numeric PIN.
 */
const WEAK_PIN_PATTERNS: ReadonlySet<string> = new Set([
  // All same digit
  '000000', '111111', '222222', '333333', '444444',
  '555555', '666666', '777777', '888888', '999999',
  // Ascending sequences
  '012345', '123456', '234567', '345678', '456789',
  // Descending sequences
  '987654', '876543', '765432', '654321', '543210',
  // Common patterns
  '000001', '121212', '123123', '112233',
]);

export interface LoginContext { ipAddress: string | null; userAgent: string | null }

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthService.name);
  private redis: RedisClientType | null = null;
  private redisSubscriber: RedisClientType | null = null;
  private redisReady = false;
  /** Emits after a user loses access so same-process SSE streams close promptly. */
  readonly userSessionsRevoked$ = new Subject<string>();

  constructor(
    @Optional() @InjectRepository(User) private readonly users: Repository<User>,
    @Optional() @InjectRepository(UserHouseAccess) private readonly access: Repository<UserHouseAccess>,
    @Optional() @InjectRepository(AuthSession) private readonly sessions: Repository<AuthSession>,
    @Optional() @InjectRepository(AuthSecurityEvent) private readonly events: Repository<AuthSecurityEvent>,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = process.env.REDIS_URL?.trim();
    if (url) {
      this.redis = createClient({ url });
      this.redis.on('error', (error: Error) => {
        this.redisReady = false;
        this.logger.warn(`Redis auth limiter unavailable: ${error.message}`);
      });
      try {
        await this.redis.connect();
        this.redisReady = true;
        this.redisSubscriber = this.redis.duplicate();
        this.redisSubscriber.on('error', (error: Error) =>
          this.logger.warn(`Redis auth revoke subscriber unavailable: ${error.message}`),
        );
        await this.redisSubscriber.connect();
        await this.redisSubscriber.subscribe(SESSION_REVOKE_CHANNEL, (userId: string) =>
          this.userSessionsRevoked$.next(userId),
        );
      } catch (error) {
        this.logger.warn(`Redis auth limiter connection failed: ${String(error)}`);
      }
    }
    await this.bootstrapAdmin();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redisSubscriber?.isOpen) await this.redisSubscriber.quit();
    if (this.redis?.isOpen) await this.redis.quit();
  }

  // ---------------------------------------------------------------------------
  // Normalisation & Hashing
  // ---------------------------------------------------------------------------

  normalizePhone(phone: string): string {
    const trimmed = phone.trim();
    // Accept local format (0xxxxxxxxx) and convert to E.164
    if (/^0[0-9]{9}$/.test(trimmed)) return `+84${trimmed.slice(1)}`;
    return trimmed;
  }

  hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }

  async hashPin(pin: string): Promise<string> {
    return argon2.hash(pin, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  }

  async verifyPin(hash: string, pin: string): Promise<boolean> {
    return argon2.verify(hash, pin);
  }

  // ---------------------------------------------------------------------------
  // PIN Strength Validation
  // ---------------------------------------------------------------------------

  validatePinStrength(pin: string): void {
    if (WEAK_PIN_PATTERNS.has(pin)) {
      throw new BadRequestException(
        'PIN quá đơn giản. Vui lòng không dùng các dãy số lặp lại hoặc liên tiếp (ví dụ: 123456, 111111).',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Device Token (unchanged — legacy MQTT bootstrap)
  // ---------------------------------------------------------------------------

  issueDeviceToken(clientId: string, mqttUser?: string): { token: string } {
    const token = process.env.MQTT_ESP32_PASS;
    if (!token) throw new ServiceUnavailableException('Device auth is not configured (MQTT_ESP32_PASS missing).');
    this.logger.log(`Issuing legacy MQTT token for clientId='${clientId}'${mqttUser ? ` mqttUser='${mqttUser}'` : ''}`);
    return { token };
  }

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  async login(
    phoneInput: string,
    pin: string,
    context: LoginContext,
  ): Promise<{ token: string; principal: AuthPrincipal }> {
    const phoneNumber = this.normalizePhone(phoneInput);
    await this.assertLoginAllowed(phoneNumber, context.ipAddress);

    const user = await this.users.findOne({ where: { phoneNumber } });

    // Constant-time: always run verifyPin even when user is not found
    const pinToVerify = user?.pinHash ?? DUMMY_PIN_HASH;

    // Check lockout before verifying (avoids unnecessary argon2 computation)
    if (user?.pinLockedUntil && user.pinLockedUntil > new Date()) {
      await this.record('LOGIN_BLOCKED', null, phoneNumber, context, 'FAILURE', {
        reason: 'lockout',
        lockedUntil: user.pinLockedUntil,
      });
      await this.throttleDelay();
      throw new HttpException('Tài khoản tạm khóa do nhập PIN sai quá nhiều lần. Vui lòng thử lại sau.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const verified = await this.verifyPin(pinToVerify, pin);

    if (!user || !user.isActive || !verified) {
      // Increment failed attempt counter for the real user
      if (user) {
        const newAttempts = user.pinFailedAttempts + 1;
        if (newAttempts >= PIN_MAX_ATTEMPTS) {
          const lockedUntil = new Date(Date.now() + PIN_LOCKOUT_MS);
          await this.users.update(user.id, { pinFailedAttempts: 0, pinLockedUntil: lockedUntil });
          this.logger.warn(`User ${user.id} locked out until ${lockedUntil.toISOString()} after ${PIN_MAX_ATTEMPTS} failed PIN attempts`);
        } else {
          await this.users.update(user.id, { pinFailedAttempts: newAttempts });
        }
      }
      await this.record('LOGIN_FAILED', null, phoneNumber, context, 'FAILURE');
      throw new UnauthorizedException('Số điện thoại hoặc mã PIN không đúng.');
    }

    // Success — reset lockout state
    if (user.pinFailedAttempts > 0 || user.pinLockedUntil !== null) {
      await this.users.update(user.id, { pinFailedAttempts: 0, pinLockedUntil: null });
    }

    const now = new Date();
    const token = randomBytes(32).toString('hex');
    const session = this.sessions.create({
      tokenHash: this.hashToken(token),
      userId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent?.slice(0, 512) ?? null,
      expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_MS),
      idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
      lastSeenAt: now,
      revokedAt: null,
    });
    await this.sessions.save(session);
    await this.record('LOGIN_SUCCESS', user.id, phoneNumber, context, 'SUCCESS');
    return { token, principal: await this.principalFor(user, session.id) };
  }

  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------

  async authenticate(token: string | undefined): Promise<AuthPrincipal> {
    if (!token) throw new UnauthorizedException('Session is required.');
    const now = new Date();
    const session = await this.sessions.findOne({ where: { tokenHash: this.hashToken(token), revokedAt: IsNull() } });
    if (!session || session.expiresAt <= now || session.idleExpiresAt <= now) {
      throw new UnauthorizedException('Session is expired or invalid.');
    }
    const user = await this.users.findOne({ where: { id: session.userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('Session is invalid.');
    if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
      await this.sessions.update(session.id, {
        lastSeenAt: now,
        idleExpiresAt: new Date(Math.min(session.expiresAt.getTime(), now.getTime() + SESSION_IDLE_MS)),
      });
    }
    return this.principalFor(user, session.id);
  }

  async logout(sessionId: string, actorId: string | null = null): Promise<void> {
    await this.sessions.update({ id: sessionId, revokedAt: IsNull() }, { revokedAt: new Date() });
    if (actorId) await this.notifySessionRevocation(actorId);
    await this.record('LOGOUT', actorId, null, { ipAddress: null, userAgent: null }, 'SUCCESS');
  }

  async revokeAllUserSessions(userId: string, event = 'SESSION_REVOKED'): Promise<void> {
    await this.sessions
      .createQueryBuilder()
      .update()
      .set({ revokedAt: new Date() })
      .where('user_id = :userId AND revoked_at IS NULL', { userId })
      .execute();
    await this.notifySessionRevocation(userId);
    await this.record(event, userId, null, { ipAddress: null, userAgent: null }, 'SUCCESS');
  }

  // ---------------------------------------------------------------------------
  // PIN Management
  // ---------------------------------------------------------------------------

  async setPin(principal: AuthPrincipal, currentPin: string, newPin: string): Promise<void> {
    const user = await this.users.findOneByOrFail({ id: principal.id });
    if (!await this.verifyPin(user.pinHash, currentPin)) {
      throw new UnauthorizedException('Mã PIN hiện tại không đúng.');
    }
    this.validatePinStrength(newPin);
    user.pinHash = await this.hashPin(newPin);
    user.mustSetPin = false;
    user.pinFailedAttempts = 0;
    user.pinLockedUntil = null;
    await this.users.save(user);
    await this.revokeAllUserSessions(user.id, 'PIN_CHANGE');
  }

  /** Admin resets a user's PIN and forces mustSetPin = true */
  async adminResetPin(userId: string, newPin: string, actorId: string): Promise<void> {
    this.validatePinStrength(newPin);
    const user = await this.users.findOneByOrFail({ id: userId });
    user.pinHash = await this.hashPin(newPin);
    user.mustSetPin = true;
    user.pinFailedAttempts = 0;
    user.pinLockedUntil = null;
    await this.users.save(user);
    await this.revokeAllUserSessions(user.id, 'PIN_RESET');
    await this.record('PIN_RESET', actorId, user.phoneNumber, { ipAddress: null, userAgent: null }, 'SUCCESS');
  }

  // ---------------------------------------------------------------------------
  // Principal & Audit
  // ---------------------------------------------------------------------------

  async principalFor(user: User, sessionId: string): Promise<AuthPrincipal> {
    const rows = user.role === UserRole.ADMIN ? [] : await this.access.find({ where: { userId: user.id } });
    return {
      id: user.id,
      phoneNumber: user.phoneNumber,
      role: user.role,
      houseIds: rows.map((row) => row.houseId),
      sessionId,
      mustSetPin: user.mustSetPin,
    };
  }

  async record(
    eventType: string,
    actorId: string | null,
    targetIdentifier: string | null,
    context: LoginContext,
    status: string,
    metadata: Record<string, unknown> | null = null,
  ): Promise<void> {
    const event = this.events.create({
      eventType,
      actorId,
      targetIdentifier,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent?.slice(0, 255) ?? null,
      status,
      metadata,
    });
    await this.events.save(event);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async assertLoginAllowed(phone: string, ip: string | null): Promise<void> {
    if (!this.redisReady || !this.redis) {
      if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('Login is temporarily unavailable.');
      return;
    }
    const keys = [
      `auth:login:phone:${createHash('sha256').update(phone).digest('hex')}`,
      `auth:login:ip:${ip ?? 'unknown'}`,
    ];
    const limits = [LOGIN_PHONE_LIMIT, LOGIN_IP_LIMIT];
    const values = await Promise.all(
      keys.map(async (key) => {
        const value = await this.redis!.incr(key);
        if (value === 1) await this.redis!.expire(key, LOGIN_WINDOW_SECONDS);
        return value;
      }),
    );
    if (values.some((value: number, i: number) => value > limits[i])) {
      await this.record('LOGIN_RATE_LIMITED', null, phone, { ipAddress: ip, userAgent: null }, 'FAILURE');
      await this.throttleDelay();
      throw new HttpException('Quá nhiều lần đăng nhập. Vui lòng thử lại sau.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private throttleDelay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 500));
  }

  private async notifySessionRevocation(userId: string): Promise<void> {
    // Emit locally even without Redis. Redis publishes the same invalidation
    // to other application replicas when it is available.
    this.userSessionsRevoked$.next(userId);
    if (this.redisReady && this.redis) {
      try {
        await this.redis.publish(SESSION_REVOKE_CHANNEL, userId);
      } catch (error) {
        this.logger.warn(`Failed to broadcast session revocation: ${String(error)}`);
      }
    }
  }

  private async bootstrapAdmin(): Promise<void> {
    const phone = process.env.AUTH_BOOTSTRAP_ADMIN_PHONE?.trim();
    const pin = process.env.AUTH_BOOTSTRAP_ADMIN_PIN?.trim();
    if (!phone || !pin || await this.users.exists({ where: {} })) return;

    if (process.env.NODE_ENV === 'production') {
      if (pin.length !== 6 || !/^[0-9]{6}$/.test(pin)) {
        throw new Error('AUTH_BOOTSTRAP_ADMIN_PIN must be exactly 6 digits.');
      }
      if (WEAK_PIN_PATTERNS.has(pin)) {
        throw new Error('AUTH_BOOTSTRAP_ADMIN_PIN is too weak (common sequence). Choose a more random PIN.');
      }
    }

    const normalizedPhone = this.normalizePhone(phone);
    await this.users.save(
      this.users.create({
        phoneNumber: normalizedPhone,
        pinHash: await this.hashPin(pin),
        role: UserRole.ADMIN,
        isActive: true,
        mustSetPin: true,
      }),
    );
    this.logger.warn(`Bootstrapped initial admin ${normalizedPhone}; rotate bootstrap environment credentials.`);
  }

  @Cron('0 */6 * * *')
  async cleanup(): Promise<void> {
    const now = new Date();
    await this.sessions
      .createQueryBuilder()
      .delete()
      .where(
        'expires_at < :now OR idle_expires_at < :now OR (revoked_at IS NOT NULL AND revoked_at < :revokedBefore)',
        { now, revokedBefore: new Date(now.getTime() - 7 * 86400000) },
      )
      .execute();
    await this.events.delete({ createdAt: LessThan(new Date(now.getTime() - 90 * 86400000)) });
  }
}
