import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { applyModifierVersionSchemaMigration, inspectModifierVersionSchema } from '../modifierVersionUpgradeSchema.js';

function fixture() {
  const db=new Database(':memory:');
  const directory=fileURLToPath(new URL('../../../../../migrations/edge/',import.meta.url));
  for(const name of readdirSync(directory).filter(n=>/^\d{4}_.*\.sql$/.test(n)&&Number(n.slice(0,4))<=17).sort())db.exec(readFileSync(join(directory,name),'utf8'));
  db.exec("INSERT INTO modifier_groups(id,name) VALUES('g','Extras'); INSERT INTO modifier_options(id,group_id,name,price_delta_amount,price_delta_currency) VALUES('o','g','Extra',-100,'MXN')");
  return db;
}
it('17→18 gives legacy entities baseline 1, preserves values and is idempotent',()=>{
  const db=fixture();try{
    applyModifierVersionSchemaMigration(db);applyModifierVersionSchemaMigration(db);
    expect(inspectModifierVersionSchema(db)).toBe(18);
    expect(db.prepare('SELECT name,version FROM modifier_groups').get()).toEqual({name:'Extras',version:1});
    expect(db.prepare('SELECT price_delta_amount,version FROM modifier_options').get()).toEqual({price_delta_amount:-100,version:1});
    for(const invalid of [0,-1,1.5,9007199254740992])expect(()=>db.prepare('UPDATE modifier_options SET version=?').run(invalid)).toThrow();
  }finally{db.close();}
});
it('rejects a partial schema18 marker and supports transaction rollback',()=>{
  const db=fixture();try{
    db.exec('BEGIN IMMEDIATE');applyModifierVersionSchemaMigration(db);db.exec('ROLLBACK');
    expect(inspectModifierVersionSchema(db)).toBe(17);
    db.pragma('user_version=18');expect(()=>inspectModifierVersionSchema(db)).toThrow('MODIFIER_SCHEMA_INVALID');
  }finally{db.close();}
});
