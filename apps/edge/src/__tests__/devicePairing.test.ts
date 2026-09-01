import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EntityId } from '@comanview/domain';
import { prepareDevelopmentDatabase } from '@comanview/database';
import { loadDeviceIdentity, rotateDeviceIdentity, saveDeviceIdentity } from '@comanview/client-sdk';
import { buildApp } from '../index.js';

const SEEDED_POS='01991a00-0000-7000-8000-000000000721';
const SEEDED_CREDENTIAL='comanview-development-pos-device-credential-0001';

function installMemoryIndexedDb():void{
  const values=new Map<string,unknown>();
  const request=(run:()=>unknown)=>{const result:any={};queueMicrotask(()=>{try{result.result=run();result.onsuccess?.();}catch(error){result.error=error;result.onerror?.();}});return result;};
  const store={get:(key:string)=>request(()=>values.get(key)),put:(value:unknown,key:string)=>request(()=>{values.set(key,value);}),delete:(key:string)=>request(()=>{values.delete(key);})};
  const database={objectStoreNames:{contains:()=>true},createObjectStore:()=>store,transaction:()=>{
    const transaction:any={objectStore:()=>store,error:null};
    setTimeout(()=>transaction.oncomplete?.(),0);
    return transaction;
  }};
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open:()=>{const opened:any=request(()=>database);opened.result=database;return opened;}}});
}

describe('local Device Pairing',()=>{
  const dbPath=join(tmpdir(),`comanview-device-pairing-${Date.now()}.db`);
  let app:FastifyInstance;
  let ownerToken='';
  const deviceId=EntityId.generate().toString();
  const credential=randomBytes(32).toString('base64url');
  let pairingId='',pairingCode='',requestToken='';

  beforeAll(async()=>{
    prepareDevelopmentDatabase(dbPath);
    app=await buildApp(dbPath,{startPrintWorker:false,startSyncWorker:false,startControlWorker:false});
    await app.ready();
    const login=await app.inject({method:'POST',url:'/auth/login',payload:{pin:'1111',deviceId:SEEDED_POS,deviceCredential:SEEDED_CREDENTIAL}});
    ownerToken=login.json().token;
  });
  afterAll(async()=>{await app.close();for(const path of [dbPath,`${dbPath}-wal`,`${dbPath}-shm`])if(existsSync(path))unlinkSync(path);});

  it('creates a proof-bound request and does not expose credential hashes',async()=>{
    const created=await app.inject({method:'POST',url:'/device-pairing/requests',payload:{deviceId,deviceType:'POS',displayName:'POS adicional',credential}});
    expect(created.statusCode).toBe(201);
    ({pairingId,pairingCode,requestToken}=created.json());
    expect(pairingCode).toMatch(/^\d{6}$/);
    const duplicate=await app.inject({method:'POST',url:'/device-pairing/requests',payload:{deviceId,deviceType:'WAITER',displayName:'Waiter test',credential}});
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toBe('DEVICE_ALREADY_REGISTERED');
    expect(JSON.stringify(created.json())).not.toContain('hash');
    expect(JSON.stringify(created.json())).not.toContain(credential);

    const denied=await app.inject({method:'GET',url:`/device-pairing/requests/${pairingId}`,headers:{'x-pairing-request-token':randomBytes(32).toString('base64url')}});
    expect(denied.statusCode).toBe(401);
    const status=await app.inject({method:'GET',url:`/device-pairing/requests/${pairingId}`,headers:{'x-pairing-request-token':requestToken}});
    expect(status.json()).toMatchObject({pairingId,status:'PENDING',device:{deviceId,status:'PENDING'}});
  });

  it('requires local permission, verifies the code and is idempotent',async()=>{
    const commandId=randomUUID();
    const noSession=await app.inject({method:'POST',url:'/device-pairing/approve',payload:{commandId,pairingId,pairingCode}});
    expect(noSession.statusCode).toBe(401);
    const wrong=await app.inject({method:'POST',url:'/device-pairing/approve',headers:{authorization:`Bearer ${ownerToken}`},payload:{commandId:randomUUID(),pairingId,pairingCode:'999999'}});
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).toBe('PAIRING_CODE_INVALID');
    const approved=await app.inject({method:'POST',url:'/device-pairing/approve',headers:{authorization:`Bearer ${ownerToken}`},payload:{commandId,pairingId,pairingCode}});
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({deviceId,status:'ACTIVE'});
    const retry=await app.inject({method:'POST',url:'/device-pairing/approve',headers:{authorization:`Bearer ${ownerToken}`},payload:{commandId,pairingId,pairingCode}});
    expect(retry.statusCode).toBe(200);
  });

  it('keeps installation readiness protected by its dedicated permission',async()=>{
    const login=await app.inject({method:'POST',url:'/auth/login',payload:{pin:'2222',deviceId:SEEDED_POS,deviceCredential:SEEDED_CREDENTIAL}});
    expect(login.statusCode).toBe(200);
    const denied=await app.inject({method:'GET',url:'/installation/readiness',headers:{authorization:`Bearer ${login.json().token}`}});
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toBe('PERMISSION_DENIED');
  });

  it('persists attempt limits and permits an authorized cancellation',async()=>{
    const limitedDeviceId=EntityId.generate().toString(),limitedCredential=randomBytes(32).toString('base64url');
    const created=await app.inject({method:'POST',url:'/device-pairing/requests',payload:{deviceId:limitedDeviceId,deviceType:'WAITER',displayName:'Waiter temporal',credential:limitedCredential}});
    const limitedPairing=created.json().pairingId as string;
    const wrongCode=created.json().pairingCode==='999999'?'000000':'999999';
    for(let attempt=1;attempt<=5;attempt++){
      const response=await app.inject({method:'POST',url:'/device-pairing/approve',headers:{authorization:`Bearer ${ownerToken}`},payload:{commandId:randomUUID(),pairingId:limitedPairing,pairingCode:wrongCode}});
      expect(response.statusCode).toBe(attempt===5?429:401);
    }
    const locked=await app.inject({method:'POST',url:'/device-pairing/approve',headers:{authorization:`Bearer ${ownerToken}`},payload:{commandId:randomUUID(),pairingId:limitedPairing,pairingCode:created.json().pairingCode}});
    expect(locked.statusCode).toBe(429);
    const commandId=randomUUID();
    const cancelled=await app.inject({method:'POST',url:`/device-pairing/${limitedPairing}/cancel`,headers:{authorization:`Bearer ${ownerToken}`},payload:{commandId}});
    expect(cancelled.statusCode).toBe(200);
    const retry=await app.inject({method:'POST',url:`/device-pairing/${limitedPairing}/cancel`,headers:{authorization:`Bearer ${ownerToken}`},payload:{commandId}});
    expect(retry.statusCode).toBe(200);
    const history=await app.inject({method:'GET',url:'/device-pairing/requests',headers:{authorization:`Bearer ${ownerToken}`}});
    expect(history.statusCode).toBe(200);
    expect(history.json().data).toEqual(expect.arrayContaining([
      expect.objectContaining({pairingId:limitedPairing,status:'CANCELLED'}),
    ]));
  });

  it('requires device proof for login and revocation invalidates sessions',async()=>{
    installMemoryIndexedDb();
    await saveDeviceIdentity({deviceId,credential,type:'POS',displayName:'POS adicional'});
    const login=await app.inject({method:'POST',url:'/auth/login',payload:{pin:'2222',deviceId,deviceCredential:credential}});
    expect(login.statusCode).toBe(200);
    const token=login.json().token as string;
    const commandId=randomUUID();
    const revoke=await app.inject({method:'POST',url:`/devices/${deviceId}/revoke`,headers:{authorization:`Bearer ${ownerToken}`},payload:{commandId,reason:'Integration test revocation'}});
    expect(revoke.statusCode).toBe(200);
    const retry=await app.inject({method:'POST',url:`/devices/${deviceId}/revoke`,headers:{authorization:`Bearer ${ownerToken}`},payload:{commandId,reason:'Integration test revocation'}});
    expect(retry.statusCode).toBe(200);
    const session=await app.inject({method:'GET',url:'/auth/session',headers:{authorization:`Bearer ${token}`}});
    expect(session.statusCode).toBe(401);
    const loginAgain=await app.inject({method:'POST',url:'/auth/login',payload:{pin:'2222',deviceId,deviceCredential:credential}});
    expect(loginAgain.statusCode).toBe(401);
    expect(loginAgain.json().error).toBe('DEVICE_REVOKED');

    const repairRequired=await app.inject({method:'POST',url:'/device-pairing/requests',payload:{
      deviceId,deviceType:'POS',displayName:'POS adicional',credential}});
    expect(repairRequired.statusCode).toBe(409);
    expect(repairRequired.json().error).toBe('DEVICE_REPAIR_REQUIRED');
    const invalidProof=await app.inject({method:'POST',url:'/device-pairing/requests',payload:{
      deviceId,deviceType:'POS',displayName:'POS adicional',credential:randomBytes(32).toString('base64url')}});
    expect(invalidProof.statusCode).toBe(409);
    expect(invalidProof.json().error).toBe('DEVICE_ALREADY_REGISTERED');
    const activeIdentity=await app.inject({method:'POST',url:'/device-pairing/requests',payload:{
      deviceId:SEEDED_POS,deviceType:'POS',displayName:'POS desarrollo',credential:SEEDED_CREDENTIAL}});
    expect(activeIdentity.statusCode).toBe(409);
    expect(activeIdentity.json().error).toBe('DEVICE_ALREADY_REGISTERED');

    const replacementIdentity=await rotateDeviceIdentity(deviceId);
    expect(replacementIdentity).not.toBeNull();
    const replacementDeviceId=replacementIdentity!.deviceId;
    const replacementCredential=replacementIdentity!.credential;
    expect(replacementDeviceId).not.toBe(deviceId);
    expect(replacementCredential).not.toBe(credential);
    await expect(loadDeviceIdentity()).resolves.toEqual(replacementIdentity);
    const replacementPairing=await app.inject({method:'POST',url:'/device-pairing/requests',payload:{
      deviceId:replacementDeviceId,deviceType:'POS',displayName:'POS adicional',credential:replacementCredential}});
    expect(replacementPairing.statusCode).toBe(201);
    const replacementApproval=await app.inject({method:'POST',url:'/device-pairing/approve',headers:{authorization:`Bearer ${ownerToken}`},
      payload:{commandId:randomUUID(),pairingId:replacementPairing.json().pairingId,pairingCode:replacementPairing.json().pairingCode}});
    expect(replacementApproval.statusCode).toBe(200);
    expect(replacementApproval.json()).toMatchObject({deviceId:replacementDeviceId,status:'ACTIVE'});
    const replacementLogin=await app.inject({method:'POST',url:'/auth/login',payload:{pin:'1111',deviceId:replacementDeviceId,deviceCredential:replacementCredential}});
    expect(replacementLogin.statusCode).toBe(200);
    const devices=await app.inject({method:'GET',url:'/devices',headers:{authorization:`Bearer ${ownerToken}`}});
    expect(devices.statusCode).toBe(200);
    expect(devices.json().data).toEqual(expect.arrayContaining([
      expect.objectContaining({deviceId,status:'REVOKED'}),
      expect.objectContaining({deviceId:replacementDeviceId,status:'ACTIVE'}),
    ]));

    const audit=await app.inject({method:'GET',url:`/audit?resourceId=${deviceId}`,headers:{authorization:`Bearer ${ownerToken}`}});
    expect(audit.statusCode).toBe(200);
    const serialized=JSON.stringify(audit.json());
    expect(serialized).not.toContain(credential);
    expect(serialized).not.toContain(pairingCode);
  });
});
