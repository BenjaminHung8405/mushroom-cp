import {
  EventSubscriber,
  EntitySubscriberInterface,
  InsertEvent,
  UpdateEvent,
} from 'typeorm';
import { RequestContextService } from '../services/request-context.service';

export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * AuditSubscriber automatically populates createdBy and updatedBy audit columns
 * for entity modifications performed via Repository.save().
 *
 * CODING STANDARD / ARCHITECTURAL REQUIREMENT:
 * Direct bulk updates via `Repository.update()` or `QueryBuilder.update()` bypass TypeORM EventSubscribers.
 * All audit-sensitive operations MUST use `Repository.save()` or manually set `updatedBy`
 * if using QueryBuilder.
 */
@EventSubscriber()
export class AuditSubscriber implements EntitySubscriberInterface {
  beforeInsert(event: InsertEvent<Record<string, unknown>>): void {
    const userId = RequestContextService.getUserId() ?? SYSTEM_USER_ID;
    if (event.entity) {
      if ('createdBy' in event.entity && !event.entity.createdBy) {
        event.entity.createdBy = userId;
      }
      if ('updatedBy' in event.entity && !event.entity.updatedBy) {
        event.entity.updatedBy = userId;
      }
    }
  }

  beforeUpdate(event: UpdateEvent<Record<string, unknown>>): void {
    const userId = RequestContextService.getUserId() ?? SYSTEM_USER_ID;
    if (event.entity && 'updatedBy' in event.entity) {
      event.entity.updatedBy = userId;
    }
  }
}

/**
 * Helper utility for performing bulk updates while enforcing audit integrity.
 * Ensures `updatedBy` is explicitly set even when using `Repository.update()`.
 */
export async function updateWithAudit<
  T extends { updatedBy?: string | null },
>(
  repository: { update: (criteria: any, partialEntity: any) => Promise<any> },
  criteria: any,
  partialEntity: Record<string, unknown>,
): Promise<any> {
  const userId = RequestContextService.getUserId() ?? SYSTEM_USER_ID;
  const entityWithAudit = {
    ...partialEntity,
    updatedBy: partialEntity.updatedBy ?? userId,
  };
  return repository.update(criteria, entityWithAudit);
}
