import Database from 'better-sqlite3';
import { readFileSync, readdirSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EntityId } from '@comanview/domain';
import { applyCatalogSchemaMigration, inspectCatalogSchema, normalizeCatalogSku } from '../catalogUpgradeSchema.js';
import { prepareDevelopmentDatabase } from '../prepareDevelopmentDatabase.js';

const directory = fileURLToPath(new URL('../../../../../migrations/edge/', import.meta.url));
function legacy() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  for (const file of readdirSync(directory).filter(name => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0,4)) <= 15).sort())
    db.exec(readFileSync(join(directory,file),'utf8'));
  db.exec(`INSERT INTO categories(id,name,active) VALUES('legacy','Category',1);
    INSERT INTO tax_profiles(id,name,rate_basis_points,calculation_mode) VALUES('tax','Zero',0,'TAX_ADDED');
    INSERT INTO products(id,name,category_id,tax_profile_id,base_price_amount,base_price_currency,sku,version)
    VALUES('a','A',NULL,'tax',100,'MXN','  abc ',4),('b','B','legacy','tax',200,'MXN','ABC',7),
    ('c','C','legacy','tax',300,'MXN','0001',2);
    INSERT OR IGNORE INTO roles(id,name) VALUES('owner-test','OWNER'),('manager-test','MANAGER');`);
  return db;
}

describe('catalog schema transition',()=>{
  it('development preparation rejects schema 16 without changing the catalog database',async()=>{
    const db=legacy(),root=mkdtempSync(join(tmpdir(),'cv-catalog-seed-guard-')),path=join(root,'edge.db');
    try{applyCatalogSchemaMigration(db);await db.backup(path);const before=readFileSync(path);
      expect(()=>prepareDevelopmentDatabase(path)).toThrow('CLIENT_CAPABILITY_REQUIRED');expect(readFileSync(path).equals(before)).toBe(true);
    }finally{db.close();rmSync(root,{recursive:true,force:true});}
  });
  it('preserves legacy categories, values, versions and restricted grants; reserves duplicate SKU keys',()=>{
    const db=legacy();try{
      db.exec("DELETE FROM role_permissions WHERE permission_code='CATALOG_MANAGE'");
      applyCatalogSchemaMigration(db);
      expect(inspectCatalogSchema(db)).toBe(16);
      expect(db.prepare("SELECT name FROM categories WHERE id='legacy'").get()).toEqual({name:'Category'});
      const system=db.prepare("SELECT id FROM categories WHERE system_key='UNCATEGORIZED'").get() as {id:string};
      expect(db.prepare("SELECT category_id,sku,version FROM products WHERE id='a'").get()).toEqual({category_id:system.id,sku:'  abc ',version:4});
      expect(db.prepare("SELECT category_id,version FROM products WHERE id='b'").get()).toEqual({category_id:'legacy',version:7});
      expect(db.prepare('SELECT * FROM catalog_sku_claims ORDER BY sku_key').all()).toEqual([
        {sku_key:'0001',product_id:'c',state:'CLAIMED'}, {sku_key:'ABC',product_id:null,state:'CONFLICT'},
      ]);
      expect(db.prepare("SELECT * FROM role_permissions WHERE permission_code='CATALOG_MANAGE'").all()).toEqual([]);
      expect(db.prepare("SELECT r.name FROM roles r JOIN role_permissions p ON p.role_id=r.id WHERE p.permission_code='CATALOG_IMPORT' ORDER BY r.name").all()).toEqual([{name:'MANAGER'},{name:'OWNER'}]);
      applyCatalogSchemaMigration(db);
      expect(db.prepare("SELECT id FROM categories WHERE system_key='UNCATEGORIZED'").get()).toEqual(system);
      expect(db.prepare('SELECT generation FROM catalog_state').get()).toEqual({generation:0});
    }finally{db.close();}
  });
  it('protects system category identity, activation and deletion',()=>{
    const db=legacy();try{
      applyCatalogSchemaMigration(db);
      for(const query of ["DELETE FROM categories WHERE system_key='UNCATEGORIZED'",
        "UPDATE categories SET active=0 WHERE system_key='UNCATEGORIZED'",
        "UPDATE categories SET system_key=NULL WHERE system_key='UNCATEGORIZED'"])
        expect(()=>db.exec(query)).toThrow('CATEGORY_SYSTEM_PROTECTED');
    }finally{db.close();}
  });
  it('rejects partial and future schemas without repairing them',()=>{
    const db=legacy();try{
      db.exec('ALTER TABLE products ADD COLUMN accidental TEXT');
      expect(()=>applyCatalogSchemaMigration(db)).toThrow();
      expect(db.pragma('user_version',{simple:true})).toBe(15);
      db.pragma('user_version=17');
      expect(()=>inspectCatalogSchema(db)).toThrow();
    }finally{db.close();}
  });
  it('fails SKU preflight before schema mutation',()=>{
    const db=legacy();try{
      db.prepare("UPDATE products SET sku=? WHERE id='a'").run('bad\u0001sku');
      expect(()=>applyCatalogSchemaMigration(db)).toThrow('SKU_INVALID');
      expect(inspectCatalogSchema(db)).toBe(15);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='catalog_state'").get()).toBeUndefined();
    }finally{db.close();}
  });
  it('rejects invalid legacy references before DDL',()=>{
    const db=legacy();try{
      db.pragma('foreign_keys=OFF');
      db.prepare("UPDATE products SET category_id='missing' WHERE id='b'").run();
      db.pragma('foreign_keys=ON');
      expect(()=>applyCatalogSchemaMigration(db)).toThrow('CATALOG_REFERENCE_INVALID');
      expect(inspectCatalogSchema(db)).toBe(15);
    }finally{db.close();}
  });
  it('rolls back SQL, grants and baseline together on failure after DDL',()=>{
    const db=legacy();
    const fault=vi.spyOn(EntityId,'generate').mockImplementationOnce(()=>{throw new Error('injected UUID failure');});
    try{
      expect(()=>applyCatalogSchemaMigration(db)).toThrow('injected UUID failure');
      expect(inspectCatalogSchema(db)).toBe(15);
      expect(db.prepare("SELECT code FROM permissions WHERE code='CATALOG_IMPORT'").get()).toBeUndefined();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='catalog_state'").get()).toBeUndefined();
      applyCatalogSchemaMigration(db);
      expect(inspectCatalogSchema(db)).toBe(16);
    }finally{fault.mockRestore();db.close();}
  });
  it('does not treat structurally current but inconsistent claims as a completed baseline',()=>{
    const db=legacy();try{
      applyCatalogSchemaMigration(db);
      db.exec("UPDATE catalog_sku_claims SET state='CLAIMED',product_id='a' WHERE sku_key='ABC'");
      expect(()=>applyCatalogSchemaMigration(db)).toThrow('CATALOG_SKU_STATE_INVALID');
      expect(db.prepare("SELECT state FROM catalog_sku_claims WHERE sku_key='ABC'").get()).toEqual({state:'CLAIMED'});
    }finally{db.close();}
  });
});

describe('SKU normalization v1',()=>{
  it('normalizes case and Unicode without losing interior spaces, punctuation or zeroes',()=>{
    expect(normalizeCatalogSku('  ａｂ-００１  ')).toBe('AB-001');
    expect(normalizeCatalogSku('a  b')).toBe('A  B');
    expect(normalizeCatalogSku('é')).toBe(normalizeCatalogSku('e\u0301'));
    expect(normalizeCatalogSku('0001')).toBe('0001');
    expect(normalizeCatalogSku('   ')).toBeNull();
    expect(normalizeCatalogSku(null)).toBeNull();
    expect(()=>normalizeCatalogSku('x\ny')).toThrow('SKU_INVALID');
    expect(()=>normalizeCatalogSku('x\u200by')).toThrow('SKU_INVALID');
  });
});
