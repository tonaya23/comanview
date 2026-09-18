import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { CatalogRepository } from '@comanview/database';
import { EntityId } from '@comanview/domain';
import { CreateProductRequestSchema } from '@comanview/contracts';
import * as schema from '@comanview/database/edge';
import { CatalogService } from './CatalogService.js';

const paths: string[] = [];
it('preserves schema14 read compatibility without inventing an OCC version', async () => {
  const sqlite = new Database(':memory:');
  try {
    const migrations = fileURLToPath(new URL('../../../../../../migrations/edge/', import.meta.url));
    for (const file of readdirSync(migrations).filter(name => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0,4)) <= 14).sort())
      sqlite.exec(readFileSync(join(migrations, file), 'utf8'));
    const profileId = randomUUID(), productId = randomUUID();
    sqlite.prepare("INSERT INTO tax_profiles(id,name,rate_basis_points,calculation_mode) VALUES(?,'Legacy',0,'TAX_ADDED')").run(profileId);
    sqlite.prepare("INSERT INTO products(id,name,tax_profile_id,base_price_amount,base_price_currency) VALUES(?,'Legacy',?,100,'MXN')").run(productId, profileId);
    const service = new CatalogService(new CatalogRepository(drizzle(sqlite,{schema})));
    expect(await service.getProduct(productId)).toMatchObject({id:productId,name:'Legacy'});
    expect((await service.getAllProducts())[0]?.version).toBeUndefined();
    await expect(service.setProductAvailability(productId,{available:false})).rejects.toMatchObject({code:'CLIENT_CAPABILITY_REQUIRED'});
  } finally { sqlite.close(); }
});
afterEach(async () => { for (const path of paths.splice(0)) await rm(path, { force: true }); });

function fixture() {
  const path = join(tmpdir(), `comanview-catalog-1w-${randomUUID()}.db`); paths.push(path);
  const sqlite = new Database(path);
  const migrations = fileURLToPath(new URL('../../../../../../migrations/edge/', import.meta.url));
  for (const file of readdirSync(migrations).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort())
    sqlite.exec(readFileSync(join(migrations, file), 'utf8'));
  const profileId = randomUUID();
  sqlite.prepare(`INSERT INTO tax_profiles(id,name,rate_basis_points,calculation_mode,active,is_default,version)
    VALUES(?,'IVA ocho',800,'TAX_ADDED',1,0,3)`).run(profileId);
  sqlite.prepare(`INSERT INTO tax_profile_revisions(tax_profile_id,revision,rate_basis_points,calculation_mode,created_at)
    VALUES(?,3,800,'TAX_ADDED',1)`).run(profileId);
  const repository = new CatalogRepository(drizzle(sqlite, { schema }));
  return { sqlite, profileId, service: new CatalogService(repository), repository };
}

const request = (profileId: string, revision = 3) => ({
  name: 'Producto fiscal', description: '', productType: 'STANDARD' as const,
  taxProfileId: profileId, taxProfileRevision: revision,
  basePrice: { amount: 10_000, currency: 'MXN' },
});

describe('current product fiscal identity', () => {
  it('uses the authoritative persisted profile and immutable revision in new snapshots', async () => {
    const f = fixture();
    try {
      const productId=randomUUID(),categoryId=randomUUID();
      f.sqlite.prepare("INSERT INTO categories(id,name) VALUES(?,'Fixture')").run(categoryId);
      f.sqlite.prepare("INSERT INTO products(id,name,category_id,tax_profile_id,tax_profile_revision,base_price_amount,base_price_currency) VALUES(?,'Product',?,?,3,10000,'MXN')").run(productId,categoryId,f.profileId);
      const created = (await f.service.getProduct(productId))!;
      expect(created.taxProfile).toMatchObject({ id: f.profileId, rateBasisPoints: 800, revision: 3 });
      const stored = f.sqlite.prepare('SELECT tax_profile_id id,tax_profile_revision revision FROM products WHERE id=?').get(created.id);
      expect(stored).toEqual({ id: f.profileId, revision: 3 });
      const product = f.repository.getProductById(EntityId.fromString(created.id))!;
      expect(product.createSnapshot(new Map(), 1)).toMatchObject({ taxRateBasisPoints: 800, taxProfileRevision: 3 });
      f.sqlite.prepare("UPDATE tax_profiles SET rate_basis_points=500,version=4 WHERE id=?").run(f.profileId);
      f.sqlite.prepare("INSERT INTO tax_profile_revisions VALUES(?,4,500,'TAX_ADDED',2)").run(f.profileId);
      expect(product.createSnapshot(new Map(), 1)).toMatchObject({ taxRateBasisPoints: 800, taxProfileRevision: 3 });
      await expect(f.service.setProductAvailability(created.id,{available:false})).rejects.toMatchObject({code:'CLIENT_CAPABILITY_REQUIRED'});
      expect(f.sqlite.prepare('SELECT tax_profile_revision revision FROM products WHERE id=?').get(created.id)).toEqual({revision:3});
    } finally { f.sqlite.close(); }
  });

  it('rejects obsolete write capabilities regardless of submitted tax fields', async () => {
    const f = fixture();
    try {
      await expect(f.service.createProduct(request(randomUUID()))).rejects.toMatchObject({code:'CLIENT_CAPABILITY_REQUIRED'});
      await expect(f.service.createProduct(request(f.profileId, 2))).rejects.toMatchObject({code:'CLIENT_CAPABILITY_REQUIRED'});
      f.sqlite.prepare('UPDATE tax_profiles SET active=0 WHERE id=?').run(f.profileId);
      await expect(f.service.createProduct(request(f.profileId))).rejects.toMatchObject({code:'CLIENT_CAPABILITY_REQUIRED'});
      expect(f.sqlite.prepare('SELECT COUNT(*) n FROM products').get()).toEqual({ n: 0 });
      expect(CreateProductRequestSchema.safeParse({ name:'Sin impuesto',description:'',productType:'STANDARD',
        basePrice:{amount:100,currency:'MXN'} }).success).toBe(false);
    } finally { f.sqlite.close(); }
  });
});
