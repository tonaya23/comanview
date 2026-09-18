import { CatalogProductVersionConflict } from '@comanview/database';
import type { Permission } from '@comanview/auth';
import type { AuthService } from '../auth/application/AuthService.js';
import type { AuthenticatedActor } from '../../app/authContext.js';
import { AppError } from '../../app/errorHandler.js';

/** Keep the security read lease until the synchronous repository transaction commits.
 * Authorization is repeated inside BEGIN IMMEDIATE, including durable receipt retries. */
export function withProductAssignmentAuthorization<T>(
  auth: Pick<AuthService, 'withCurrentAuthorization'> | undefined,
  actor: AuthenticatedActor,
  binding: { edgeId: string; tenantId: string; locationId: string },
  permission: Permission,
  execute: (authorize: (epoch: number) => void) => T,
): Promise<T> {
  if (!auth) throw new AppError('RECOVERY_REQUIRED', 503, 'No se modificó el producto.');
  return auth.withCurrentAuthorization(actor, (revalidate, floor) =>
    execute((epoch) => {
      const current = revalidate();
      if (!current.permissions.includes(permission))
        throw new AppError('PERMISSION_DENIED', 403, 'No tienes permiso para esta asignación.');
      if (current.tenantId !== binding.tenantId || current.locationId !== binding.locationId)
        throw new AppError(
          'ADMINISTRATION_BINDING_MISMATCH',
          403,
          'La sesión no pertenece a esta instalación.',
        );
      if (
        !floor ||
        floor.minimumSchemaVersion !== 16 ||
        floor.recoveryState !== 'NORMAL' ||
        floor.recoveryEpoch !== epoch ||
        floor.binding?.edgeId !== binding.edgeId ||
        floor.binding.tenantId !== binding.tenantId ||
        floor.binding.locationId !== binding.locationId ||
        floor.catalogUpgradeJournal
      )
        throw new AppError('RECOVERY_REQUIRED', 503, 'No se modificó el producto.');
    }),
  );
}

export function rethrowProductVersionConflict(error: unknown): void {
  if (error instanceof CatalogProductVersionConflict)
    throw new AppError(
      'CATALOG_VERSION_CONFLICT',
      409,
      'El producto cambió. Revisa la versión vigente antes de reintentar.',
      {
        entityType: 'PRODUCT',
        entityId: error.entityId,
        expectedVersion: error.expectedVersion,
        actualVersion: error.actualVersion,
      },
    );
}
