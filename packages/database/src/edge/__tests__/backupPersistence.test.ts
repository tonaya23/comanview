import { describe,expect,it } from 'vitest';import Database from 'better-sqlite3';import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync } from 'node:fs';import { join,dirname } from 'node:path';import { fileURLToPath } from 'node:url';
import * as schema from '../schema.js';import { BackupRepository } from '../repositories/BackupRepository.js';
const root=join(dirname(fileURLToPath(import.meta.url)),'../../../../../migrations/edge');
const migrations=['0000_initial.sql','0001_payments_cash.sql','0002_order_item_special_instructions.sql','0003_printing.sql','0004_kds.sql','0005_local_auth.sql','0006_audit_log.sql','0007_cash_operations_closure.sql','0008_tables_waiter.sql','0009_operational_realtime.sql','0010_sync_foundation.sql','0011_edge_provisioning.sql','0012_signed_licensing_configuration.sql','0013_device_pairing_readiness.sql','0014_backup_recovery.sql'];
describe('BackupRepository persistence',()=>{it('recovers an interrupted attempt without losing its durable schedule',()=>{const sqlite=new Database(':memory:');for(const file of migrations)sqlite.exec(readFileSync(join(root,file),'utf8'));const repo=new BackupRepository(drizzle(sqlite,{schema}));
  const now=new Date('2026-09-01T00:00:00.000Z'),next=new Date('2026-09-01T01:00:00.000Z');expect(repo.startAttempt(next,now)).toBe(true);
  repo.create({backupId:'01991a00-0000-7000-8000-000000000601',tenantId:'01991a00-0000-7000-8000-000000000602',locationId:'01991a00-0000-7000-8000-000000000603',sourceEdgeId:'01991a00-0000-7000-8000-000000000604',recoveryEpoch:0,status:'CREATING',trigger:'PERIODIC',destinationType:'LOCAL',artifactPath:'backup',formatVersion:1,schemaVersion:14,applicationVersion:'1V',businessDate:null,createdAt:now,commandId:'01991a00-0000-7000-8000-000000000605'});
  repo.recoverInterrupted(new Date('2026-09-01T00:05:00.000Z'));expect(repo.get('01991a00-0000-7000-8000-000000000601')).toMatchObject({status:'FAILED',failureCode:'BACKUP_INTERRUPTED'});
  expect(repo.runtime()).toMatchObject({workerStatus:'IDLE',nextPeriodicBackupAt:next,lastFailureCode:'BACKUP_INTERRUPTED'});sqlite.close();});
  it('stamps newly appended events with the durable recovery epoch',()=>{const sqlite=new Database(':memory:');for(const file of migrations)sqlite.exec(readFileSync(join(root,file),'utf8'));
    sqlite.prepare(`INSERT INTO edge_installations(singleton_key,edge_id,tenant_id,location_id,created_at,recovery_epoch)
      VALUES('PRIMARY',?,?,?,?,2)`).run('01991a00-0000-7000-8000-000000000611','01991a00-0000-7000-8000-000000000612','01991a00-0000-7000-8000-000000000613',Date.now());
    sqlite.prepare(`INSERT INTO event_log(id,event_type,aggregate_type,aggregate_id,payload,occurred_at,recovery_epoch)
      VALUES(?,?,?,?,?,?,0)`).run('01991a00-0000-7000-8000-000000000614','TEST','TEST','01991a00-0000-7000-8000-000000000615','{}',Date.now());
    expect(sqlite.prepare('SELECT recovery_epoch FROM event_log').get()).toEqual({recovery_epoch:2});sqlite.close();
  });
  it('migrates a pre-1V installation incrementally without changing existing event identity',()=>{const sqlite=new Database(':memory:');for(const file of migrations.slice(0,-1))sqlite.exec(readFileSync(join(root,file),'utf8'));
    sqlite.prepare(`INSERT INTO event_log(id,event_type,aggregate_type,aggregate_id,payload,occurred_at,local_sequence)
      VALUES(?,?,?,?,?,?,?)`).run('01991a00-0000-7000-8000-000000000621','ORDER_CREATED','ORDER','01991a00-0000-7000-8000-000000000622','{}',Date.now(),17);
    sqlite.exec(readFileSync(join(root,'0014_backup_recovery.sql'),'utf8'));
    expect(sqlite.prepare('SELECT id,local_sequence,recovery_epoch FROM event_log').get()).toEqual({id:'01991a00-0000-7000-8000-000000000621',local_sequence:17,recovery_epoch:0});sqlite.close();
  });});
