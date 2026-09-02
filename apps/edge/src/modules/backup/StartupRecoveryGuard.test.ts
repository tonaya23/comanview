import { afterEach,describe,expect,it } from 'vitest';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';import { join } from 'node:path';import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { MemoryRecoverySecurityStore,updateRecoverySecurityFloor } from './RecoverySecurityStore.js';
import { assessStartupDatabase } from './StartupRecoveryGuard.js';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const binding={tenantId:'01991a00-0000-7000-8000-000000000701',locationId:'01991a00-0000-7000-8000-000000000702',edgeId:'01991a00-0000-7000-8000-000000000703'};
describe('startup database safety',()=>{
  it('distinguishes first boot from an established installation with a missing database',async()=>{const root=await mkdtemp(join(tmpdir(),'cv-startup-'));roots.push(root);const path=join(root,'edge.db'),store=new MemoryRecoverySecurityStore();
    expect(await assessStartupDatabase(path,store)).toBe('FIRST_BOOT');let floor=await store.load();await store.save(updateRecoverySecurityFloor(floor,{installationEstablished:true}));
    expect(await assessStartupDatabase(path,store)).toBe('RECOVERY_REQUIRED');expect(await store.load()).toMatchObject({recoveryState:'RECOVERY_REQUIRED'});});
  it('treats a pre-1V durable Edge secret as established installation evidence',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cv-startup-legacy-'));roots.push(root);const path=join(root,'edge.db'),store=new MemoryRecoverySecurityStore();
    expect(await assessStartupDatabase(path,store,true)).toBe('RECOVERY_REQUIRED');
    expect(await store.load()).toMatchObject({installationEstablished:true,recoveryState:'RECOVERY_REQUIRED'});
  });
  it('rejects corruption without replacing it with an empty SQLite database',async()=>{const root=await mkdtemp(join(tmpdir(),'cv-startup-'));roots.push(root);const path=join(root,'edge.db'),store=new MemoryRecoverySecurityStore();
    await writeFile(path,'not sqlite');await store.save(updateRecoverySecurityFloor(await store.load(),{installationEstablished:true,binding}));
    expect(await assessStartupDatabase(path,store)).toBe('RECOVERY_REQUIRED');await expect((await import('node:fs/promises')).readFile(path,'utf8')).resolves.toBe('not sqlite');});
  it('accepts a valid established SQLite database',async()=>{const root=await mkdtemp(join(tmpdir(),'cv-startup-'));roots.push(root);const path=join(root,'edge.db'),store=new MemoryRecoverySecurityStore();const db=new Database(path);db.exec('CREATE TABLE ok(id INTEGER)');db.close();
    const sqlite=new Database(path);sqlite.exec(`CREATE TABLE edge_installations(singleton_key TEXT PRIMARY KEY,tenant_id TEXT,location_id TEXT,edge_id TEXT);
      INSERT INTO edge_installations VALUES('PRIMARY','${binding.tenantId}','${binding.locationId}','${binding.edgeId}')`);sqlite.close();
    await store.save(updateRecoverySecurityFloor(await store.load(),{installationEstablished:true,binding}));expect(await assessStartupDatabase(path,store)).toBe('NORMAL');});
  it('rejects a structurally valid but empty replacement database for an established installation',async()=>{const root=await mkdtemp(join(tmpdir(),'cv-startup-'));roots.push(root);const path=join(root,'edge.db'),store=new MemoryRecoverySecurityStore();
    const db=new Database(path);db.close();await store.save(updateRecoverySecurityFloor(await store.load(),{installationEstablished:true,binding}));
    expect(await assessStartupDatabase(path,store)).toBe('RECOVERY_REQUIRED');
  });
  it('rejects a current 1V database when its established Security Floor disappeared',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cv-startup-floor-missing-'));roots.push(root);const path=join(root,'edge.db'),store=new MemoryRecoverySecurityStore();
    const db=new Database(path);db.exec(`CREATE TABLE edge_installations(singleton_key TEXT PRIMARY KEY,tenant_id TEXT,location_id TEXT,edge_id TEXT,recovery_epoch INTEGER);
      INSERT INTO edge_installations VALUES('PRIMARY','${binding.tenantId}','${binding.locationId}','${binding.edgeId}',2)`);db.close();
    expect(await assessStartupDatabase(path,store,true)).toBe('RECOVERY_REQUIRED');
    expect(await store.load()).toMatchObject({installationEstablished:true,binding:null,recoveryState:'RECOVERY_REQUIRED'});
  });
  it('rejects a current 1V database in strict startup even if every other external marker was lost',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cv-startup-floor-and-secret-missing-'));roots.push(root);const path=join(root,'edge.db'),store=new MemoryRecoverySecurityStore();
    const db=new Database(path);db.exec(`CREATE TABLE edge_installations(singleton_key TEXT PRIMARY KEY,tenant_id TEXT,location_id TEXT,edge_id TEXT,recovery_epoch INTEGER);
      INSERT INTO edge_installations VALUES('PRIMARY','${binding.tenantId}','${binding.locationId}','${binding.edgeId}',2)`);db.close();
    expect(await assessStartupDatabase(path,store,false,true)).toBe('RECOVERY_REQUIRED');
  });
  it('allows a legacy pre-1V database to migrate once when only Edge credential evidence exists',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cv-startup-legacy-db-'));roots.push(root);const path=join(root,'edge.db'),store=new MemoryRecoverySecurityStore();
    const db=new Database(path);db.exec(`CREATE TABLE edge_installations(singleton_key TEXT PRIMARY KEY,tenant_id TEXT,location_id TEXT,edge_id TEXT);
      INSERT INTO edge_installations VALUES('PRIMARY','${binding.tenantId}','${binding.locationId}','${binding.edgeId}')`);db.close();
    expect(await assessStartupDatabase(path,store,true)).toBe('NORMAL');
  });
});
