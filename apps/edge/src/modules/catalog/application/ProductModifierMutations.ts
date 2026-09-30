import type Database from 'better-sqlite3';
import type { ProductModifierCommand } from '@comanview/contracts';
import { canonicalCatalogJson } from '@comanview/contracts';
import { readProductModifierConfigurations, readModifierAdministration } from '@comanview/database';
import { AppError } from '../../../app/errorHandler.js';
/** Caller owns current authorization, IMMEDIATE transaction and receipt/event boundary. */
export function mutateProductModifiers(
  db: Database.Database,
  command: ProductModifierCommand,
  actorId: string,
) {
  if (db.pragma('user_version', { simple: true }) !== 18)
    throw new AppError('RECOVERY_REQUIRED', 503, 'La instalación no está lista.');
  const before = readProductModifierConfigurations(db).find(
    (p) => p.productId === command.entityId,
  );
  if (!before) throw new AppError('PRODUCT_NOT_FOUND', 404, 'Producto no encontrado.');
  if (before.version !== command.expectedVersion)
    throw new AppError('CATALOG_VERSION_CONFLICT', 409, 'El producto cambió.');
  const groups = readModifierAdministration(db),
    seen = new Set<string>();
  const assignments = command.payload.assignments
    .map((a) => {
      const group = groups.find((g) => g.id === a.groupId);
      if (seen.has(a.groupId) || !group || group.version !== a.groupVersion)
        throw new AppError('CATALOG_REFERENCE_CHANGED', 409, 'Revisa los grupos actuales.');
      seen.add(a.groupId);
      if (
        !group.active ||
        (group.minSelections > 0 && !group.options.some((o) => o.active && o.available))
      )
        throw new AppError(
          'MODIFIER_CONFIGURATION_UNSATISFIABLE',
          409,
          'El grupo no puede seleccionarse.',
        );
      const overrides: typeof a.overrides = {};
      for (const [id, price] of Object.entries(a.overrides)) {
        const option = group.options.find((o) => o.id === id);
        if (!option)
          throw new AppError('CATALOG_REFERENCE_CHANGED', 409, 'La opción no pertenece al grupo.');
        if (
          price.currency !== before.currency ||
          option.unitPriceDelta.currency !== before.currency
        )
          throw new AppError('CATALOG_CURRENCY_MISMATCH', 409, 'La moneda no coincide.');
        if (price.amount !== option.unitPriceDelta.amount) overrides[id] = price;
      }
      if (group.options.some((o) => o.unitPriceDelta.currency !== before.currency))
        throw new AppError('CATALOG_CURRENCY_MISMATCH', 409, 'La moneda no coincide.');
      return { groupId: a.groupId, displayOrder: a.displayOrder, overrides };
    })
    .sort((a, b) => a.displayOrder - b.displayOrder || a.groupId.localeCompare(b.groupId));
  const changed = canonicalCatalogJson(assignments) !== canonicalCatalogJson(before.assignments);
  if (!changed) return { changed, before };
  if (before.version >= Number.MAX_SAFE_INTEGER)
    throw new AppError('CATALOG_VERSION_CONFLICT', 409, 'Versión fuera de rango.');
  db.prepare('DELETE FROM modifier_price_overrides WHERE product_id=?').run(command.entityId);
  db.prepare('DELETE FROM product_modifier_groups WHERE product_id=?').run(command.entityId);
  for (const a of assignments) {
    db.prepare(
      'INSERT INTO product_modifier_groups(product_id,modifier_group_id,display_order) VALUES(?,?,?)',
    ).run(command.entityId, a.groupId, a.displayOrder);
    for (const [id, price] of Object.entries(a.overrides))
      db.prepare(
        'INSERT INTO modifier_price_overrides(product_id,modifier_option_id,price_delta_amount,price_delta_currency) VALUES(?,?,?,?)',
      ).run(command.entityId, id, price.amount, price.currency);
  }
  db.prepare(
    'UPDATE products SET version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=?',
  ).run(Date.now(), actorId, command.entityId, before.version);
  return { changed, before };
}
