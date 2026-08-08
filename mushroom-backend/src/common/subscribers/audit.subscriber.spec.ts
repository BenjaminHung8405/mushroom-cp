import { AuditSubscriber, SYSTEM_USER_ID } from './audit.subscriber';
import { RequestContextService } from '../services/request-context.service';
import type { InsertEvent, UpdateEvent } from 'typeorm';

describe('AuditSubscriber', () => {
  let subscriber: AuditSubscriber;

  beforeEach(() => {
    subscriber = new AuditSubscriber();
  });

  describe('beforeInsert', () => {
    it('should assign createdBy and updatedBy from RequestContextService when available', () => {
      const entity: Record<string, unknown> = {
        createdBy: null,
        updatedBy: null,
      };
      const mockEvent = { entity } as InsertEvent<Record<string, unknown>>;

      RequestContextService.run({ userId: 'user-123' }, () => {
        subscriber.beforeInsert(mockEvent);
        expect(entity.createdBy).toBe('user-123');
        expect(entity.updatedBy).toBe('user-123');
      });
    });

    it('should fallback createdBy and updatedBy to SYSTEM_USER_ID when context is empty', () => {
      const entity: Record<string, unknown> = {
        createdBy: null,
        updatedBy: null,
      };
      const mockEvent = { entity } as InsertEvent<Record<string, unknown>>;

      subscriber.beforeInsert(mockEvent);
      expect(entity.createdBy).toBe(SYSTEM_USER_ID);
      expect(entity.updatedBy).toBe(SYSTEM_USER_ID);
    });
  });

  describe('beforeUpdate', () => {
    it('should set updatedBy from RequestContextService when available', () => {
      const entity: Record<string, unknown> = { updatedBy: null };
      const mockEvent = { entity } as UpdateEvent<Record<string, unknown>>;

      RequestContextService.run({ userId: 'user-456' }, () => {
        subscriber.beforeUpdate(mockEvent);
        expect(entity.updatedBy).toBe('user-456');
      });
    });

    it('should fallback updatedBy to SYSTEM_USER_ID when context is empty', () => {
      const entity: Record<string, unknown> = { updatedBy: null };
      const mockEvent = { entity } as UpdateEvent<Record<string, unknown>>;

      subscriber.beforeUpdate(mockEvent);
      expect(entity.updatedBy).toBe(SYSTEM_USER_ID);
    });
  });
});
