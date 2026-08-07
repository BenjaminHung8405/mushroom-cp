import { Subject } from 'rxjs';
import { AuthService } from './auth.service';
import { UserRole } from './entities/user.entity';

describe('AuthService session primitives', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  beforeEach(() => { process.env.NODE_ENV = 'test'; });
  afterAll(() => { process.env.NODE_ENV = originalNodeEnv; });
  const user = {
    id: '7e7f1d4b-92b3-4db4-a36c-083793f33e2a',
    email: 'operator@example.com',
    passwordHash: '',
    role: UserRole.OPERATOR,
    isActive: true,
    mustChangePassword: false,
  };

  function serviceWith(repositories: Record<string, unknown> = {}) {
    const users = repositories.users ?? { findOne: jest.fn().mockResolvedValue(user), findOneByOrFail: jest.fn(), exists: jest.fn() };
    const access = repositories.access ?? { find: jest.fn().mockResolvedValue([{ houseId: 'house-a' }]) };
    const sessions = repositories.sessions ?? { create: jest.fn((value) => value), save: jest.fn().mockResolvedValue(undefined), update: jest.fn(), findOne: jest.fn() };
    const events = repositories.events ?? { create: jest.fn((value) => value), save: jest.fn().mockResolvedValue(undefined), delete: jest.fn() };
    return { service: new AuthService(users as never, access as never, sessions as never, events as never), users, access, sessions, events };
  }

  it('normalizes emails and stores only a SHA-256 digest for generated sessions', async () => {
    const { service, users, sessions } = serviceWith();
    user.passwordHash = await service.hashPassword('correct horse battery staple');

    const result = await service.login(' Operator@Example.COM ', 'correct horse battery staple', { ipAddress: '127.0.0.1', userAgent: 'jest' });

    expect(users.findOne).toHaveBeenCalledWith({ where: { email: 'operator@example.com' } });
    expect(result.token).toHaveLength(64);
    expect(sessions.save).toHaveBeenCalledWith(expect.objectContaining({
      tokenHash: service.hashToken(result.token),
      userId: user.id,
    }));
    expect(sessions.save).not.toHaveBeenCalledWith(expect.objectContaining({ tokenHash: result.token }));
    expect(result.principal.houseIds).toEqual(['house-a']);
  });

  it('broadcasts local session invalidation after revoking every user session', async () => {
    const queryBuilder = { update: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), execute: jest.fn().mockResolvedValue(undefined) };
    const { service } = serviceWith({ sessions: { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder), create: jest.fn(), save: jest.fn(), update: jest.fn(), findOne: jest.fn() } });
    const revoked: string[] = [];
    service.userSessionsRevoked$.subscribe((userId) => revoked.push(userId));

    await service.revokeAllUserSessions(user.id, 'PASSWORD_RESET');

    expect(queryBuilder.where).toHaveBeenCalledWith('user_id = :userId AND revoked_at IS NULL', { userId: user.id });
    expect(revoked).toEqual([user.id]);
  });
});
