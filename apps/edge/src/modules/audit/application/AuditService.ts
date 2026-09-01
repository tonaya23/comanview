import type { AuditListQuery, AuditListResponse } from '@comanview/contracts';
import type { AuditRepository } from '@comanview/database';
import type { AuthenticatedActor } from '../../../app/authContext.js';

export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  list(query: AuditListQuery, actor: AuthenticatedActor): AuditListResponse {
    return {
      entries: this.repository
        .list({
          ...(query.action ? { action: query.action } : {}),
          ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
          ...(query.resourceId ? { resourceId: query.resourceId } : {}),
          ...(query.from ? { from: new Date(query.from) } : {}),
          ...(query.to ? { to: new Date(query.to) } : {}),
          limit: query.limit,
          locationId: actor.locationId,
        })
        .map((entry) => ({
          ...entry,
          actorType: entry.actorType ?? 'USER',
          authorizationId: entry.authorizationId ?? null,
          source: entry.source ?? null,
          occurredAt: entry.occurredAt.toISOString(),
        })),
    };
  }
}
