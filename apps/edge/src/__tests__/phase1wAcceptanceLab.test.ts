import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAcceptanceSchema14, labPaths } from '../phase1wAcceptanceLabCli.js';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});

describe('Phase 1W acceptance lab boundaries',()=>{
  it('accepts only a direct isolated run below the dedicated parent',async()=>{
    const parent=await mkdtemp(join(tmpdir(),'comanview-phase-1w-parent-'));roots.push(parent);
    expect(labPaths(parent,join(parent,'phase-1w-smoke')).root).toBe(join(parent,'phase-1w-smoke'));
    expect(()=>labPaths(parent,join(parent,'..','phase-1w-smoke'))).toThrow('ACCEPTANCE_LAB_UNSAFE_PATH');
    expect(()=>labPaths(parent,join(parent,'phase-1v-upgrade'))).toThrow('ACCEPTANCE_LAB_UNSAFE_PATH');
  });

  it('creates an unseeded real schema 14 baseline with no identity or financial activity',async()=>{
    const root=await mkdtemp(join(tmpdir(),'comanview-phase-1w-schema-'));roots.push(root);const path=join(root,'edge.db');
    createAcceptanceSchema14(path);const db=new Database(path,{readonly:true,fileMustExist:true});try{
      expect(db.pragma('user_version',{simple:true})).toBe(14);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='backup_records'").get()).toBeDefined();
      expect(db.prepare('SELECT COUNT(*) n FROM edge_installations').get()).toEqual({n:0});
      for(const table of ['orders','payments','cash_sessions','cash_movements','users','devices'])
        expect(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get(),table).toEqual({n:0});
    }finally{db.close();}
  });
});
