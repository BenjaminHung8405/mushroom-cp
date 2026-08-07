import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthPolicyGuard } from './auth-policy.guard';
import { UserRole } from './entities/user.entity';

function context(request: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('AuthPolicyGuard', () => {
  const dataSource = { query: jest.fn() } as never;
  const guard = new AuthPolicyGuard(dataSource);
  const operator = { id: 'u1', email: 'operator@example.com', role: UserRole.OPERATOR, houseIds: ['house-a'], sessionId: 's1', mustChangePassword: false };

  beforeEach(() => jest.clearAllMocks());

  it('returns 404 for a device outside the authenticated house scope', async () => {
    (dataSource.query as jest.Mock).mockResolvedValue([{ house_id: 'house-b' }]);
    await expect(guard.canActivate(context({ method: 'GET', path: '/devices/device-b/telemetry', params: { id: 'device-b' }, authUser: operator }))).rejects.toBeInstanceOf(NotFoundException);
  });
  it('allows an operator device request in scope', async () => {
    (dataSource.query as jest.Mock).mockResolvedValue([{ house_id: 'house-a' }]);
    await expect(guard.canActivate(context({ method: 'GET', path: '/devices/device-a/telemetry', params: { id: 'device-a' }, authUser: operator }))).resolves.toBe(true);
  });
  it('prevents an auditor from mutating any resource', async () => {
    await expect(guard.canActivate(context({ method: 'POST', path: '/devices/device-a/setpoint', params: { id: 'device-a' }, authUser: { ...operator, role: UserRole.AUDITOR } }))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
