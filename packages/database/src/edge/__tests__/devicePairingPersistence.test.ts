import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as schema from '../schema.js';
import { DeviceRepository } from '../repositories/DeviceRepository.js';
import type { NewAuditEntry } from '../repositories/AuditRepository.js';
import { prepareDevelopmentDatabase } from '../prepareDevelopmentDatabase.js';

const here=dirname(fileURLToPath(import.meta.url));
const migrations=['0000_initial.sql','0001_payments_cash.sql','0002_order_item_special_instructions.sql','0003_printing.sql','0004_kds.sql','0005_local_auth.sql','0006_audit_log.sql','0007_cash_operations_closure.sql','0008_tables_waiter.sql','0009_operational_realtime.sql','0010_sync_foundation.sql','0011_edge_provisioning.sql','0012_signed_licensing_configuration.sql','0013_device_pairing_readiness.sql','0014_backup_recovery.sql'];
const ids={tenant:'01991a00-0000-7000-8000-000000000301',location:'01991a00-0000-7000-8000-000000000302',edge:'01991a00-0000-7000-8000-000000000303',pairing:'01991a00-0000-7000-8000-000000000304',device:'01991a00-0000-7000-8000-000000000305',owner:'01991a00-0000-7000-8000-000000000306',auth:'01991a00-0000-7000-8000-000000000307'};

function setup(){const sqlite=new Database(':memory:');sqlite.pragma('foreign_keys=ON');for(const name of migrations)sqlite.exec(readFileSync(join(here,`../../../../../migrations/edge/${name}`),'utf8'));return {sqlite,repo:new DeviceRepository(drizzle(sqlite,{schema}))};}
function audit(auditId:string):NewAuditEntry{return {auditId,occurredAt:new Date('2026-08-29T00:00:00Z'),tenantId:ids.tenant,locationId:ids.location,deviceId:null,sessionId:null,actorUserId:null,actorRole:null,actorType:'CLOUD_ADMIN_AUTHORIZATION',authorizationId:ids.auth,source:'CLOUD_INSTALLATION_AUTHORIZATION',authorizedByUserId:null,authorizedByRole:null,action:'FIRST_DEVICE_BOOTSTRAP_COMPLETED',entityType:'INSTALLATION',entityId:ids.auth,outcome:'SUCCESS',reason:'test bootstrap',commandId:null,before:null,after:null,amountAffected:null,currency:null,eventId:null};}

describe('device pairing persistence',()=>{
  it('prepares a new provisioning database without known Users or Devices and leaves bootstrap pending',()=>{
    const path=join(process.env['TEMP']??'.',`comanview-clean-provision-${crypto.randomUUID()}.db`);
    prepareDevelopmentDatabase(path,{seedOperationalIdentities:false});
    const sqlite=new Database(path);
    expect(sqlite.prepare('SELECT COUNT(*) count FROM users').get()).toEqual({count:0});
    expect(sqlite.prepare('SELECT COUNT(*) count FROM devices').get()).toEqual({count:0});
    expect(sqlite.prepare('SELECT COUNT(*) count FROM device_pairing_requests').get()).toEqual({count:0});
    expect(sqlite.prepare("SELECT bootstrap_status status FROM installation_state WHERE singleton_key='PRIMARY'").get())
      .toEqual({status:'PENDING'});
    sqlite.close();
    for(const suffix of ['','-wal','-shm'])try{unlinkSync(path+suffix);}catch{/* absent */}
  });
  it('migrates foreign keys cleanly and atomically completes the first installation',()=>{
    const {sqlite,repo}=setup();
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    const now=new Date('2026-08-29T00:00:00Z');
    repo.createPairing({pairingId:ids.pairing,deviceId:ids.device,edgeId:ids.edge,tenantId:ids.tenant,locationId:ids.location,deviceType:'POS',displayName:'POS inicial',codeHash:'code-hash',requestTokenHash:'request-hash',credentialHash:'secret-hash',now,expiresAt:new Date(now.getTime()+600_000),sessionTimeoutMinutes:720,audit:{...audit('01991a00-0000-7000-8000-000000000308'),actorType:'SYSTEM',authorizationId:null,action:'DEVICE_PAIRING_CREATED',entityType:'PAIRING',entityId:ids.pairing}});
    repo.completeBootstrap({pairingId:ids.pairing,credentialId:'01991a00-0000-7000-8000-000000000309',authorizationId:ids.auth,cloudAckCommandId:'01991a00-0000-7000-8000-000000000314',owner:{id:ids.owner,displayName:'Owner inicial',pinHash:'scrypt-pin'},now,audit:audit('01991a00-0000-7000-8000-000000000310')});
    expect(repo.getPairing(ids.pairing)?.device.status).toBe('ACTIVE');
    expect(repo.installation()).toMatchObject({bootstrapStatus:'COMPLETED',firstDeviceId:ids.device,initialOwnerUserId:ids.owner});
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    sqlite.close();
  });

  it('rolls back pairing consumption when bootstrap persistence fails',()=>{
    const {sqlite,repo}=setup();const now=new Date('2026-08-29T00:00:00Z');
    repo.createPairing({pairingId:ids.pairing,deviceId:ids.device,edgeId:ids.edge,tenantId:ids.tenant,locationId:ids.location,deviceType:'POS',displayName:'POS inicial',codeHash:'code-hash',requestTokenHash:'request-hash',credentialHash:'secret-hash',now,expiresAt:new Date(now.getTime()+600_000),sessionTimeoutMinutes:720,audit:{...audit('01991a00-0000-7000-8000-000000000311'),actorType:'SYSTEM',authorizationId:null,action:'DEVICE_PAIRING_CREATED',entityType:'PAIRING',entityId:ids.pairing}});
    sqlite.prepare(`INSERT INTO users(id,tenant_id,location_id,display_name,status,pin_hash,created_at) VALUES(?,?,?,?,?,?,?)`).run(ids.owner,ids.tenant,ids.location,'Existing','ACTIVE','hash',now.getTime());
    expect(()=>repo.completeBootstrap({pairingId:ids.pairing,credentialId:'01991a00-0000-7000-8000-000000000312',authorizationId:ids.auth,cloudAckCommandId:'01991a00-0000-7000-8000-000000000315',owner:{id:ids.owner,displayName:'Owner inicial',pinHash:'scrypt-pin'},now,audit:audit('01991a00-0000-7000-8000-000000000313')})).toThrow();
    expect(repo.getPairing(ids.pairing)).toMatchObject({pairing:{status:'PENDING'},device:{status:'PENDING'}});
    expect(repo.installation()?.bootstrapStatus).toBe('PENDING');
    sqlite.close();
  });
});
