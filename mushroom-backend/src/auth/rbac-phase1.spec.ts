import { AuditSubscriber } from '../common/subscribers/audit.subscriber';
import { RequestContextService } from '../common/services/request-context.service';
import { FixRbacSchemaGaps1720656000021 } from '../database/migrations/1720656000021-fix-rbac-schema-gaps';
import { AddAuditFkIndexes1720656000022 } from '../database/migrations/1720656000022-add-audit-fk-indexes';
import {
  SeedSystemUser1720656000023,
  SYSTEM_USER_ID,
} from '../database/migrations/1720656000023-seed-system-user';

describe('Phase 1 RBAC Audit & Schema Updates', () => {
  it('should instantiate migration 1720656000021 successfully', () => {
    const migration = new FixRbacSchemaGaps1720656000021();
    expect(migration.name).toBe('FixRbacSchemaGaps1720656000021');
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });

  it('should instantiate migration 1720656000022 with transactional = false', () => {
    const migration = new AddAuditFkIndexes1720656000022();
    expect(migration.name).toBe('AddAuditFkIndexes1720656000022');
    expect(migration.transactional).toBe(false);
  });

  it('should instantiate migration 1720656000023 to seed SYSTEM_USER_ID', () => {
    const migration = new SeedSystemUser1720656000023();
    expect(migration.name).toBe('SeedSystemUser1720656000023');
    expect(SYSTEM_USER_ID).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('should set createdBy and updatedBy in AuditSubscriber when userId exists in context', () => {
    const subscriber = new AuditSubscriber();
    const mockEntity: Record<string, any> = {
      createdBy: null,
      updatedBy: null,
    };

    RequestContextService.run({ userId: 'user-123-uuid' }, () => {
      subscriber.beforeInsert({ entity: mockEntity } as any);
      expect(mockEntity.createdBy).toBe('user-123-uuid');
      expect(mockEntity.updatedBy).toBe('user-123-uuid');

      mockEntity.updatedBy = null;
      subscriber.beforeUpdate({ entity: mockEntity } as any);
      expect(mockEntity.updatedBy).toBe('user-123-uuid');
    });
  });

  it('should not overwrite createdBy if already set', () => {
    const subscriber = new AuditSubscriber();
    const mockEntity: Record<string, any> = {
      createdBy: 'existing-author',
      updatedBy: null,
    };

    RequestContextService.run({ userId: 'user-123-uuid' }, () => {
      subscriber.beforeInsert({ entity: mockEntity } as any);
      expect(mockEntity.createdBy).toBe('existing-author');
      expect(mockEntity.updatedBy).toBe('user-123-uuid');
    });
  });
});
