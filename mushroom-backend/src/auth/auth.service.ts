import { HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
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
import { AuthPrincipal, SESSION_IDLE_MS, SESSION_MAX_AGE_MS, SESSION_TOUCH_INTERVAL_MS } from './auth.types';

const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHRmb3J0ZXN0$MKh8fFXo6P1jqKnAjglmr1nCIWFYtrIvzm0TTTTW06I';
const LOGIN_EMAIL_LIMIT = 8;
const LOGIN_IP_LIMIT = 40;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const SESSION_REVOKE_CHANNEL = 'mushroom:auth:session-revoked';

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
      this.redis.on('error', (error) => { this.redisReady = false; this.logger.warn(`Redis auth limiter unavailable: ${error.message}`); });
      try {
        await this.redis.connect();
        this.redisReady = true;
        this.redisSubscriber = this.redis.duplicate();
        this.redisSubscriber.on('error', (error) => this.logger.warn(`Redis auth revoke subscriber unavailable: ${error.message}`));
        await this.redisSubscriber.connect();
        await this.redisSubscriber.subscribe(SESSION_REVOKE_CHANNEL, (userId) => this.userSessionsRevoked$.next(userId));
      } catch (error) { this.logger.warn(`Redis auth limiter connection failed: ${String(error)}`); }
    }
    await this.bootstrapAdmin();
  }
  async onModuleDestroy(): Promise<void> { if (this.redisSubscriber?.isOpen) await this.redisSubscriber.quit(); if (this.redis?.isOpen) await this.redis.quit(); }

  normalizeEmail(email: string): string { return email.trim().toLowerCase(); }
  issueDeviceToken(clientId: string, mqttUser?: string): { token: string } {
    const token = process.env.MQTT_ESP32_PASS;
    if (!token) throw new ServiceUnavailableException('Device auth is not configured (MQTT_ESP32_PASS missing).');
    this.logger.log(`Issuing legacy MQTT token for clientId='${clientId}'${mqttUser ? ` mqttUser='${mqttUser}'` : ''}`);
    return { token };
  }
  hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
  async hashPassword(password: string): Promise<string> { return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 }); }
  async verifyPassword(hash: string, password: string): Promise<boolean> { return argon2.verify(hash, password); }

  async login(emailInput: string, password: string, context: LoginContext): Promise<{ token: string; principal: AuthPrincipal }> {
    const email = this.normalizeEmail(emailInput);
    await this.assertLoginAllowed(email, context.ipAddress);
    const user = await this.users.findOne({ where: { email } });
    const verified = await this.verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password);
    if (!user || !user.isActive || !verified) {
      await this.record('LOGIN_FAILED', null, email, context, 'FAILURE');
      throw new UnauthorizedException('Email or password is incorrect.');
    }
    const now = new Date();
    const token = randomBytes(32).toString('hex');
    const session = this.sessions.create({ tokenHash: this.hashToken(token), userId: user.id, ipAddress: context.ipAddress, userAgent: context.userAgent?.slice(0, 512) ?? null, expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_MS), idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_MS), lastSeenAt: now, revokedAt: null });
    await this.sessions.save(session);
    await this.record('LOGIN_SUCCESS', user.id, email, context, 'SUCCESS');
    return { token, principal: await this.principalFor(user, session.id) };
  }

  async authenticate(token: string | undefined): Promise<AuthPrincipal> {
    if (!token) throw new UnauthorizedException('Session is required.');
    const now = new Date();
    const session = await this.sessions.findOne({ where: { tokenHash: this.hashToken(token), revokedAt: IsNull() } });
    if (!session || session.expiresAt <= now || session.idleExpiresAt <= now) throw new UnauthorizedException('Session is expired or invalid.');
    const user = await this.users.findOne({ where: { id: session.userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('Session is invalid.');
    if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
      await this.sessions.update(session.id, { lastSeenAt: now, idleExpiresAt: new Date(Math.min(session.expiresAt.getTime(), now.getTime() + SESSION_IDLE_MS)) });
    }
    return this.principalFor(user, session.id);
  }
  async logout(sessionId: string, actorId: string | null = null): Promise<void> { await this.sessions.update({ id: sessionId, revokedAt: IsNull() }, { revokedAt: new Date() }); if (actorId) await this.notifySessionRevocation(actorId); await this.record('LOGOUT', actorId, null, { ipAddress: null, userAgent: null }, 'SUCCESS'); }
  async revokeAllUserSessions(userId: string, event = 'SESSION_REVOKED'): Promise<void> { await this.sessions.createQueryBuilder().update().set({ revokedAt: new Date() }).where('user_id = :userId AND revoked_at IS NULL', { userId }).execute(); await this.notifySessionRevocation(userId); await this.record(event, userId, null, { ipAddress: null, userAgent: null }, 'SUCCESS'); }
  async changePassword(principal: AuthPrincipal, currentPassword: string, newPassword: string): Promise<void> { const user = await this.users.findOneByOrFail({ id: principal.id }); if (!await this.verifyPassword(user.passwordHash, currentPassword)) throw new UnauthorizedException('Current password is incorrect.'); user.passwordHash = await this.hashPassword(newPassword); user.mustChangePassword = false; await this.users.save(user); await this.revokeAllUserSessions(user.id, 'PASSWORD_CHANGE'); }

  async principalFor(user: User, sessionId: string): Promise<AuthPrincipal> { const rows = user.role === UserRole.ADMIN ? [] : await this.access.find({ where: { userId: user.id } }); return { id: user.id, email: user.email, role: user.role, houseIds: rows.map((row) => row.houseId), sessionId, mustChangePassword: user.mustChangePassword }; }
  async record(eventType: string, actorId: string | null, targetEmail: string | null, context: LoginContext, status: string, metadata: Record<string, unknown> | null = null): Promise<void> { const event = this.events.create({ eventType, actorId, targetEmail, ipAddress: context.ipAddress, userAgent: context.userAgent?.slice(0, 255) ?? null, status, metadata }); await this.events.save(event); }

  private async assertLoginAllowed(email: string, ip: string | null): Promise<void> {
    if (!this.redisReady || !this.redis) { if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('Login is temporarily unavailable.'); return; }
    const keys = [`auth:login:email:${createHash('sha256').update(email).digest('hex')}`, `auth:login:ip:${ip ?? 'unknown'}`];
    const limits = [LOGIN_EMAIL_LIMIT, LOGIN_IP_LIMIT];
    const values = await Promise.all(keys.map(async (key) => { const value = await this.redis!.incr(key); if (value === 1) await this.redis!.expire(key, LOGIN_WINDOW_SECONDS); return value; }));
    if (values.some((value, i) => value > limits[i])) { await this.record('LOGIN_RATE_LIMITED', null, email, { ipAddress: ip, userAgent: null }, 'FAILURE'); await new Promise((resolve) => setTimeout(resolve, 500)); throw new HttpException('Too many login attempts.', HttpStatus.TOO_MANY_REQUESTS); }
  }
  private async notifySessionRevocation(userId: string): Promise<void> {
    // Emit locally even without Redis. Redis publishes the same invalidation
    // to other application replicas when it is available.
    this.userSessionsRevoked$.next(userId);
    if (this.redisReady && this.redis) {
      try { await this.redis.publish(SESSION_REVOKE_CHANNEL, userId); }
      catch (error) { this.logger.warn(`Failed to broadcast session revocation: ${String(error)}`); }
    }
  }
  private async bootstrapAdmin(): Promise<void> { const email = process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL?.trim(); const password = process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD; if (!email || !password || await this.users.exists({ where: {} })) return; if (process.env.NODE_ENV === 'production' && (password.length < 16 || /change_me|changeme|default|example/i.test(password))) throw new Error('AUTH_BOOTSTRAP_ADMIN_PASSWORD is unsafe.'); const normalized = this.normalizeEmail(email); await this.users.save(this.users.create({ email: normalized, passwordHash: await this.hashPassword(password), role: UserRole.ADMIN, isActive: true, mustChangePassword: true })); this.logger.warn(`Bootstrapped initial admin ${normalized}; rotate bootstrap environment credentials.`); }
  @Cron('0 */6 * * *') async cleanup(): Promise<void> { const now = new Date(); await this.sessions.createQueryBuilder().delete().where('expires_at < :now OR idle_expires_at < :now OR (revoked_at IS NOT NULL AND revoked_at < :revokedBefore)', { now, revokedBefore: new Date(now.getTime() - 7 * 86400000) }).execute(); await this.events.delete({ createdAt: LessThan(new Date(now.getTime() - 90 * 86400000)) }); }
}
