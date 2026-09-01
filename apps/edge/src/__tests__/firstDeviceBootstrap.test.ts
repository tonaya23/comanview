import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { EdgeSyncConfig } from '@comanview/config';
import { EntityId } from '@comanview/domain';
import { createEdgeDatabase, prepareDevelopmentDatabase } from '@comanview/database';
import { hashPairingCode, signInstallationAuthorization } from '@comanview/licensing';
import { createPairingAuthorizationData, parsePairingAuthorizationData,
  serializePairingAuthorizationData } from '@comanview/client-sdk';
import { buildApp } from '../index.js';

describe('first Device and OWNER bootstrap',()=>{
  const dbPath=join(tmpdir(),`comanview-first-device-${Date.now()}.db`);
  const edgeId=EntityId.generate().toString(),tenantId=EntityId.generate().toString(),locationId=EntityId.generate().toString();
  const deviceId=EntityId.generate().toString(),ownerId=EntityId.generate().toString(),authorizationId=EntityId.generate().toString();
  const credential=randomBytes(32).toString('base64url');
  const keys=generateKeyPairSync('ed25519');
  const privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'}).toString();
  const publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();
  const config:EdgeSyncConfig={enabled:false,cloudUrl:null,token:null,configuredEdgeId:null,batchSize:50,pollIntervalMs:5_000,
    requestTimeoutMs:1_000,leaseDurationMs:60_000,heartbeatIntervalMs:30_000,edgeVersion:'test',schemaVersion:'13',
    licensing:{enforcementEnabled:false,publicKeyring:{'installation-test':publicKey},pullIntervalMs:300_000,maxBackoffMs:3_600_000,checkpointIntervalMs:60_000}};
  let app:FastifyInstance;

  beforeAll(async()=>{
    prepareDevelopmentDatabase(dbPath);
    const handle=createEdgeDatabase(dbPath);
    const sqlite=(handle.db as unknown as {$client:{exec(value:string):void;prepare(value:string):{run(...values:unknown[]):unknown;get(...values:unknown[]):unknown;all(...values:unknown[]):unknown[]}}}).$client;
    sqlite.exec(`DELETE FROM auth_sessions;DELETE FROM login_attempts;DELETE FROM device_credentials;DELETE FROM device_pairing_requests;
      DELETE FROM user_roles;DELETE FROM users;DELETE FROM devices;DELETE FROM audit_log;`);
    sqlite.prepare("INSERT INTO edge_installations(singleton_key,edge_id,tenant_id,location_id,created_at,provisioning_state,provisioned_at,activated_at) VALUES('PRIMARY',?,?,?,?, 'ACTIVE',?,?) ON CONFLICT(singleton_key) DO UPDATE SET edge_id=excluded.edge_id,tenant_id=excluded.tenant_id,location_id=excluded.location_id,provisioning_state='ACTIVE'")
      .run(edgeId,tenantId,locationId,Date.now(),Date.now(),Date.now());
    sqlite.exec("UPDATE installation_state SET bootstrap_status='PENDING',completed_at=NULL,authorization_id=NULL,first_device_id=NULL,initial_owner_user_id=NULL,cloud_ack_command_id=NULL,cloud_acknowledged_at=NULL,cloud_ack_attempt_count=0,cloud_ack_next_attempt_at=NULL,cloud_ack_last_error=NULL WHERE singleton_key='PRIMARY'");
    handle.close();
    app=await buildApp(dbPath,{syncConfig:config,startPrintWorker:false,startSyncWorker:false,startControlWorker:false});
    await app.ready();
  });
  afterAll(async()=>{await app.close();for(const path of [dbPath,`${dbPath}-wal`,`${dbPath}-shm`])if(existsSync(path))unlinkSync(path);});

  it('atomically consumes a signed authorization, creates one OWNER and survives restart',async()=>{
    const created=await app.inject({method:'POST',url:'/device-pairing/requests',payload:{deviceId,deviceType:'POS',displayName:'POS principal',credential}});
    expect(created.statusCode).toBe(201);
    const pairing=created.json();
    const inspection=createEdgeDatabase(dbPath);
    const stored=(inspection.db as unknown as {$client:{prepare(value:string):{get(...values:unknown[]):unknown}}}).$client
      .prepare('SELECT p.edge_id edgeId,p.tenant_id tenantId,p.location_id locationId,p.code_hash codeHash,d.name displayName,d.device_type deviceType FROM device_pairing_requests p JOIN devices d ON d.id=p.device_id WHERE p.pairing_id=?').get(pairing.pairingId) as Record<string,string>;
    inspection.close();
    expect(stored).toMatchObject({edgeId,tenantId,locationId,displayName:'POS principal',deviceType:'POS',codeHash:hashPairingCode(pairing.pairingId,pairing.pairingCode)});
    const copiedPairing=parsePairingAuthorizationData(serializePairingAuthorizationData(
      createPairingAuthorizationData(pairing,{deviceId,type:'POS',displayName:'POS principal'}),
    ));
    expect(copiedPairing).toEqual({schemaVersion:1,pairingId:pairing.pairingId,
      pairingCode:pairing.pairingCode,deviceId,deviceType:'POS',displayName:'POS principal'});
    expect(JSON.stringify(copiedPairing)).not.toContain(credential);
    expect(copiedPairing).not.toHaveProperty('requestToken');
    const issuedAt=new Date(),expiresAt=new Date(issuedAt.getTime()+600_000);
    const authorization=signInstallationAuthorization({formatVersion:1,typ:'comanview-installation-authorization',authorizationId,
      tenantId,locationId,edgeId,pairingId:copiedPairing.pairingId,
      pairingCodeHash:hashPairingCode(copiedPairing.pairingId,copiedPairing.pairingCode),
      deviceId:copiedPairing.deviceId,deviceType:copiedPairing.deviceType,displayName:copiedPairing.displayName,
      initialOwnerId:ownerId,initialOwnerDisplayName:'Owner inicial',
      issuedAt:issuedAt.toISOString(),expiresAt:expiresAt.toISOString()},'installation-test',privateKey);
    const completePayload={pairingId:pairing.pairingId,pairingCode:pairing.pairingCode,requestToken:pairing.requestToken,authorization,ownerPin:'8642'};
    const displayNameMismatch=signInstallationAuthorization({formatVersion:1,typ:'comanview-installation-authorization',authorizationId,
      tenantId,locationId,edgeId,pairingId:pairing.pairingId,pairingCodeHash:hashPairingCode(pairing.pairingId,pairing.pairingCode),
      deviceId,deviceType:'POS',displayName:'POS principal clean',initialOwnerId:ownerId,initialOwnerDisplayName:'Owner inicial',
      issuedAt:issuedAt.toISOString(),expiresAt:expiresAt.toISOString()},'installation-test',privateKey);
    const warn=vi.spyOn(app.log,'warn');
    const mismatched=await app.inject({method:'POST',url:'/device-pairing/bootstrap/complete',
      payload:{...completePayload,authorization:displayNameMismatch}});
    expect(mismatched.statusCode).toBe(401);
    expect(mismatched.json().error).toBe('INSTALLATION_AUTHORIZATION_INVALID');
    expect(warn).toHaveBeenCalledWith({component:'device-bootstrap',stage:'BINDING_VALIDATION',
      code:'INSTALLATION_AUTHORIZATION_BINDING_INVALID',mismatchedFields:['displayName']},
    'Installation authorization binding validation failed');
    const rejectedInspection=createEdgeDatabase(dbPath);
    const rejectedSqlite=(rejectedInspection.db as unknown as {$client:{prepare(value:string):{get(...values:unknown[]):unknown}}}).$client;
    expect(rejectedSqlite.prepare('SELECT COUNT(*) count FROM users').get()).toEqual({count:0});
    expect(rejectedSqlite.prepare("SELECT status FROM devices WHERE id=?").get(deviceId)).toEqual({status:'PENDING'});
    expect(rejectedSqlite.prepare("SELECT status,authorization_id authorizationId FROM device_pairing_requests WHERE pairing_id=?").get(pairing.pairingId))
      .toEqual({status:'PENDING',authorizationId:null});
    expect(rejectedSqlite.prepare("SELECT bootstrap_status bootstrapStatus FROM installation_state WHERE singleton_key='PRIMARY'").get())
      .toEqual({bootstrapStatus:'PENDING'});
    rejectedInspection.close();
    warn.mockRestore();
    const wrongBinding=signInstallationAuthorization({formatVersion:1,typ:'comanview-installation-authorization',authorizationId,
      tenantId:EntityId.generate().toString(),locationId,edgeId,pairingId:pairing.pairingId,
      pairingCodeHash:hashPairingCode(pairing.pairingId,pairing.pairingCode),deviceId,deviceType:'POS',displayName:'POS principal',
      initialOwnerId:ownerId,initialOwnerDisplayName:'Owner inicial',issuedAt:issuedAt.toISOString(),expiresAt:expiresAt.toISOString()},
      'installation-test',privateKey);
    expect((await app.inject({method:'POST',url:'/device-pairing/bootstrap/complete',payload:{...completePayload,authorization:wrongBinding}})).json().error)
      .toBe('INSTALLATION_AUTHORIZATION_INVALID');
    const expired=signInstallationAuthorization({formatVersion:1,typ:'comanview-installation-authorization',authorizationId,
      tenantId,locationId,edgeId,pairingId:pairing.pairingId,pairingCodeHash:hashPairingCode(pairing.pairingId,pairing.pairingCode),
      deviceId,deviceType:'POS',displayName:'POS principal',initialOwnerId:ownerId,initialOwnerDisplayName:'Owner inicial',
      issuedAt:new Date(issuedAt.getTime()-1_200_000).toISOString(),expiresAt:new Date(issuedAt.getTime()-600_000).toISOString()},
      'installation-test',privateKey);
    expect((await app.inject({method:'POST',url:'/device-pairing/bootstrap/complete',payload:{...completePayload,authorization:expired}})).json().error)
      .toBe('INSTALLATION_AUTHORIZATION_INVALID');
    const completed=await app.inject({method:'POST',url:'/device-pairing/bootstrap/complete',payload:completePayload});
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({deviceId,status:'ACTIVE'});
    expect((await app.inject({method:'POST',url:'/device-pairing/bootstrap/complete',payload:completePayload})).statusCode).toBe(200);
    const login=await app.inject({method:'POST',url:'/auth/login',payload:{deviceId,deviceCredential:credential,pin:'8642'}});
    expect(login.statusCode).toBe(200);
    expect(login.json().user).toMatchObject({id:ownerId,roles:['OWNER']});
    const noSessionReadiness=await app.inject({method:'GET',url:'/installation/readiness'});
    expect(noSessionReadiness.statusCode).toBe(401);
    expect(noSessionReadiness.json().error).toBe('AUTHENTICATION_REQUIRED');
    const ownerHeaders={authorization:`Bearer ${login.json().token}`};
    const [devices,pairings,readiness]=await Promise.all([
      app.inject({method:'GET',url:'/devices',headers:ownerHeaders}),
      app.inject({method:'GET',url:'/device-pairing/requests',headers:ownerHeaders}),
      app.inject({method:'GET',url:'/installation/readiness',headers:ownerHeaders}),
    ]);
    expect(devices.statusCode).toBe(200);
    expect(pairings.statusCode).toBe(200);
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json()).toMatchObject({productionReadiness:'NOT_READY',components:expect.arrayContaining([
      expect.objectContaining({key:'DEVICES',state:'READY'}),expect.objectContaining({key:'STATIONS',state:'NOT_READY'}),
      expect.objectContaining({key:'BACKUP',state:'PENDING_PHASE',code:'PENDING_1V'}),
    ])});
    const secondDeviceId=EntityId.generate().toString(),secondCredential=randomBytes(32).toString('base64url');
    const second=(await app.inject({method:'POST',url:'/device-pairing/requests',payload:{deviceId:secondDeviceId,
      deviceType:'POS',displayName:'POS segundo',credential:secondCredential}})).json();
    const secondAuthorization=signInstallationAuthorization({formatVersion:1,typ:'comanview-installation-authorization',
      authorizationId:EntityId.generate().toString(),tenantId,locationId,edgeId,pairingId:second.pairingId,
      pairingCodeHash:hashPairingCode(second.pairingId,second.pairingCode),deviceId:secondDeviceId,deviceType:'POS',
      displayName:'POS segundo',initialOwnerId:EntityId.generate().toString(),initialOwnerDisplayName:'Otro Owner',
      issuedAt:issuedAt.toISOString(),expiresAt:expiresAt.toISOString()},'installation-test',privateKey);
    const closed=await app.inject({method:'POST',url:'/device-pairing/bootstrap/complete',payload:{pairingId:second.pairingId,
      pairingCode:second.pairingCode,requestToken:second.requestToken,authorization:secondAuthorization,ownerPin:'9753'}});
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error).toBe('INSTALLATION_BOOTSTRAP_CLOSED');

    await app.close();
    const handle=createEdgeDatabase(dbPath);
    const sqlite=(handle.db as unknown as {$client:{prepare(value:string):{get(...values:unknown[]):unknown;all(...values:unknown[]):unknown[]}}}).$client;
    const snapshot=sqlite.prepare("SELECT bootstrap_status bootstrapStatus,authorization_id authorizationId,cloud_ack_command_id cloudAckCommandId FROM installation_state WHERE singleton_key='PRIMARY'").get() as {bootstrapStatus:string;authorizationId:string;cloudAckCommandId:string}|undefined;
    const serialized=JSON.stringify(sqlite.prepare('SELECT * FROM device_credentials').all());
    expect(snapshot).toMatchObject({bootstrapStatus:'COMPLETED',authorizationId});
    expect(snapshot?.cloudAckCommandId).toBeTruthy();
    expect(serialized).not.toContain(credential);
    handle.close();
    app=await buildApp(dbPath,{syncConfig:config,startPrintWorker:false,startSyncWorker:false,startControlWorker:false});
    await app.ready();
    expect((await app.inject({method:'POST',url:'/auth/login',payload:{deviceId,deviceCredential:credential,pin:'8642'}})).statusCode).toBe(200);
  });
});
