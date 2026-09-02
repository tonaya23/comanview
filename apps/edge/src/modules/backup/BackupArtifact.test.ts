import { afterEach,describe,expect,it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createEncryptedBackupArtifact,verifyEncryptedBackupArtifact } from './BackupArtifact.js';

const tenantId='01991a00-0000-7000-8000-000000000701',locationId='01991a00-0000-7000-8000-000000000702',
  edgeId='01991a00-0000-7000-8000-000000000703';
const directories:string[]=[];
afterEach(async()=>{for(const path of directories.splice(0))await rm(path,{recursive:true,force:true});});

async function fixture(){const root=await mkdtemp(join(tmpdir(),'comanview-backup-test-'));directories.push(root);const path=join(root,'edge.db');
  const db=new Database(path);db.pragma('journal_mode=WAL');db.exec(`CREATE TABLE edge_installations(singleton_key TEXT PRIMARY KEY,edge_id TEXT,tenant_id TEXT,location_id TEXT,recovery_epoch INTEGER NOT NULL DEFAULT 0);
    INSERT INTO edge_installations VALUES('PRIMARY','${edgeId}','${tenantId}','${locationId}',0);
    CREATE TABLE orders(id TEXT PRIMARY KEY,status TEXT);INSERT INTO orders VALUES('01991a00-0000-7000-8000-000000000704','OPEN');
    CREATE TABLE payments(id TEXT PRIMARY KEY,amount_applied INTEGER);INSERT INTO payments VALUES('01991a00-0000-7000-8000-000000000711',4500);
    CREATE TABLE cash_sessions(id TEXT PRIMARY KEY,status TEXT);INSERT INTO cash_sessions VALUES('01991a00-0000-7000-8000-000000000712','OPEN');
    CREATE TABLE event_log(id TEXT PRIMARY KEY,local_sequence INTEGER);INSERT INTO event_log VALUES('01991a00-0000-7000-8000-000000000713',9);
    CREATE TABLE audit_log(audit_id TEXT PRIMARY KEY,entry_hash TEXT);INSERT INTO audit_log VALUES('01991a00-0000-7000-8000-000000000714','hash-chain-entry');`);return {root,path,db,key:randomBytes(32).toString('base64url')};}

describe('encrypted SQLite backup artifact',()=>{
  it('creates a consistent WAL snapshot, encrypts it and preserves persisted IDs',async()=>{const f=await fixture();
    const result=await createEncryptedBackupArtifact({source:f.db,destinationDirectory:join(f.root,'backups'),
      backupId:'01991a00-0000-7000-8000-000000000705',binding:{tenantId,locationId,edgeId,recoveryEpoch:0},
      recoveryKey:f.key,trigger:'MANUAL',destinationType:'LOCAL',businessDate:null});
    f.db.prepare("UPDATE orders SET status='CLOSED'").run();const encrypted=await readFile(join(result.artifactPath,'database.enc'));
    expect(encrypted.subarray(0,16).toString()).not.toContain('SQLite format 3');
    expect(await readFile(join(result.artifactPath,'manifest.json'),'utf8')).not.toContain(f.key);
    const verified=await verifyEncryptedBackupArtifact({artifactPath:result.artifactPath,recoveryKey:f.key,
      expectedBinding:{tenantId,locationId,edgeId}});const restored=new Database(verified.stagedDatabasePath,{readonly:true});
    expect(restored.prepare('SELECT id,status FROM orders').get()).toEqual({id:'01991a00-0000-7000-8000-000000000704',status:'OPEN'});
    expect(restored.prepare('SELECT id,amount_applied FROM payments').get()).toEqual({id:'01991a00-0000-7000-8000-000000000711',amount_applied:4500});
    expect(restored.prepare('SELECT id,status FROM cash_sessions').get()).toEqual({id:'01991a00-0000-7000-8000-000000000712',status:'OPEN'});
    expect(restored.prepare('SELECT id,local_sequence FROM event_log').get()).toEqual({id:'01991a00-0000-7000-8000-000000000713',local_sequence:9});
    expect(restored.prepare('SELECT audit_id,entry_hash FROM audit_log').get()).toEqual({audit_id:'01991a00-0000-7000-8000-000000000714',entry_hash:'hash-chain-entry'});
    restored.close();await verified.cleanup();
    await expect(verifyEncryptedBackupArtifact({artifactPath:result.artifactPath,recoveryKey:f.key,
      expectedBinding:{tenantId,locationId:'01991a00-0000-7000-8000-000000000799',edgeId}})).rejects.toThrow('RECOVERY_LOCATION_MISMATCH');f.db.close();});

  it('fails closed for a wrong key and a tampered artifact',async()=>{const f=await fixture();const result=await createEncryptedBackupArtifact({source:f.db,
    destinationDirectory:join(f.root,'backups'),backupId:'01991a00-0000-7000-8000-000000000706',binding:{tenantId,locationId,edgeId,recoveryEpoch:0},
    recoveryKey:f.key,trigger:'MANUAL',destinationType:'LOCAL',businessDate:null});f.db.close();
    await expect(verifyEncryptedBackupArtifact({artifactPath:result.artifactPath,recoveryKey:randomBytes(32).toString('base64url')})).rejects.toThrow();
    const payload=join(result.artifactPath,'database.enc'),bytes=await readFile(payload);bytes[0]=(bytes[0]??0)^1;await writeFile(payload,bytes);
    await expect(verifyEncryptedBackupArtifact({artifactPath:result.artifactPath,recoveryKey:f.key})).rejects.toThrow('BACKUP_HASH_MISMATCH');});
});
