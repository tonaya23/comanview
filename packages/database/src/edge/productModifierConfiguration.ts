import type Database from 'better-sqlite3';
import {
  ProductModifierConfigurationSchema,
  type ProductModifierConfiguration,
} from '@comanview/contracts';
import { readModifierAdministration } from './modifierAdministration.js';
/** Set reads for all Products; no per-product/group/option query fan-out. */
export function readProductModifierConfigurations(
  db: Database.Database,
): ProductModifierConfiguration[] {
  const groups = readModifierAdministration(db);
  const products = db
    .prepare('SELECT id,version,base_price_currency currency FROM products ORDER BY id')
    .all() as { id: string; version: number; currency: string }[];
  const assignments = db
    .prepare(
      'SELECT product_id productId,modifier_group_id groupId,display_order displayOrder FROM product_modifier_groups ORDER BY display_order,modifier_group_id',
    )
    .all() as { productId: string; groupId: string; displayOrder: number }[];
  const overrides = db
    .prepare(
      'SELECT m.product_id productId,m.modifier_option_id optionId,o.group_id groupId,m.price_delta_amount amount,m.price_delta_currency currency FROM modifier_price_overrides m JOIN modifier_options o ON o.id=m.modifier_option_id',
    )
    .all() as {
    productId: string;
    optionId: string;
    groupId: string;
    amount: number;
    currency: string;
  }[];
  return products.map((p) => {
    const assigned = assignments.filter((a) => a.productId === p.id);
    return ProductModifierConfigurationSchema.parse({
      productId: p.id,
      version: p.version,
      currency: p.currency,
      groups: groups.filter((g) => assigned.some((a) => a.groupId === g.id)),
      assignments: assigned.map((a) => ({
        groupId: a.groupId,
        displayOrder: a.displayOrder,
        overrides: Object.fromEntries(
          overrides
            .filter((o) => o.productId === p.id && o.groupId === a.groupId)
            .map((o) => [o.optionId, { amount: o.amount, currency: o.currency }]),
        ),
      })),
    });
  });
}
