import { describe,expect,it } from 'vitest';
import { mkdtemp,readFile,readdir,rm,writeFile } from 'node:fs/promises';import { join } from 'node:path';import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { addRevokedDevice,createRecoverySecurityStore,DevelopmentRecoverySecurityStore,emptyRecoverySecurityFloor,ensureRecoveryKey,isDeviceRevokedByFloor,
  initializeRecoverySecurityFloor,MemoryRecoverySecurityStore,updateRecoverySecurityFloor } from './RecoverySecurityStore.js';

describe('Recovery Security Floor',()=>{
  it('keeps epoch and sticky security state monotonic and tracks revocations compactly',()=>{let floor=ensureRecoveryKey(emptyRecoverySecurityFloor()).floor;
    floor=updateRecoverySecurityFloor(floor,{installationEstablished:true,recoveryEpoch:3,stickyDeclaredState:'TERMINATED'});
    floor=addRevokedDevice(floor,'01991a00-0000-7000-8000-000000000721');
    expect(floor.recoveryEpoch).toBe(3);expect(floor.recoveryKey).toHaveLength(43);
    expect(isDeviceRevokedByFloor(floor,'01991a00-0000-7000-8000-000000000721')).toBe(true);
    expect(floor.revokedDeviceBloom.length).toBeLessThan(12_000);
  });
  it('initializes an upgrade floor from durable binding, revocations and signed revision floors',async()=>{
    const sqlite=new Database(':memory:');
    try{
      sqlite.exec(`CREATE TABLE devices(id TEXT PRIMARY KEY,status TEXT NOT NULL);
        INSERT INTO devices VALUES('revoked-device','REVOKED'),('active-device','ACTIVE');
        CREATE TABLE edge_control_documents(document_type TEXT NOT NULL,revision INTEGER NOT NULL);
        INSERT INTO edge_control_documents VALUES('LICENSE',4),('FEATURE_FLAGS',2),('CONFIGURATION',3);
        CREATE TABLE edge_control_runtime(singleton_key TEXT PRIMARY KEY,sticky_declared_state TEXT);
        INSERT INTO edge_control_runtime VALUES('PRIMARY','SUSPENDED');`);
      const store=new MemoryRecoverySecurityStore();
      const floor=await initializeRecoverySecurityFloor({store,sqlite,binding:{tenantId:'tenant',locationId:'location',edgeId:'edge'}});
      expect(floor).toMatchObject({installationEstablished:true,recoveryState:'NORMAL',
        binding:{tenantId:'tenant',locationId:'location',edgeId:'edge'},
        maximumSignedRevisions:{LICENSE:4,FEATURE_FLAGS:2,CONFIGURATION:3},stickyDeclaredState:'SUSPENDED'});
      expect(isDeviceRevokedByFloor(floor,'revoked-device')).toBe(true);
      expect(floor.recoveryKey).toHaveLength(43);
    }finally{sqlite.close();}
  });
  it.skipIf(process.platform!=='win32')('persists production recovery state through DPAPI without plaintext key material',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cv-dpapi-')),path=join(root,'floor.bin');try{
      const store=createRecoverySecurityStore({NODE_ENV:'production',COMANVIEW_RECOVERY_SECURITY_STORE:'windows-dpapi',
        COMANVIEW_RECOVERY_SECURITY_PATH:path});const floor=ensureRecoveryKey(await store.load()).floor;
      await store.save(floor);expect((await readFile(path)).toString('utf8')).not.toContain(floor.recoveryKey!);
      expect((await store.load()).recoveryKey).toBe(floor.recoveryKey);
    }finally{await rm(root,{recursive:true,force:true});}
  },20_000);
  it('preserves a corrupt anchor and fails closed with a durable recovery marker',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cv-recovery-corrupt-'));try{const path=join(root,'security.json');
      await writeFile(path,'not valid recovery state');const store=new DevelopmentRecoverySecurityStore(path);
      await expect(store.load()).resolves.toMatchObject({installationEstablished:true,recoveryState:'RECOVERY_REQUIRED',binding:null});
      await expect(store.load()).resolves.toMatchObject({installationEstablished:true,recoveryState:'RECOVERY_REQUIRED'});
      expect((await readdir(root)).some(name=>name.startsWith('security.json.corrupt-'))).toBe(true);
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
