import {
  PairingAuthorizationDataSchema,
  type PairingCreated,
  type PairingStatus,
  type DeviceType,
  type PairingAuthorizationData,
} from '@comanview/contracts';
export type ClientDeviceAuthorizationStatus = 'UNKNOWN' | 'ACTIVE' | 'REVOKED';
export interface ClientDeviceIdentity {
  deviceId:string;
  credential:string;
  type:DeviceType;
  displayName:string;
  authorizationStatus?:ClientDeviceAuthorizationStatus;
}
export interface ClientDevicePairing {
  pairingId:string;
  requestToken:string;
  pairingCode:string;
  expiresAt:string;
  deviceId:string;
  currentStatus:PairingStatus;
}
export type DeviceOnboardingState = 'ACTIVE' | 'UNREGISTERED' | 'PENDING' | 'EXPIRED' | 'CANCELLED' | 'REVOKED';
export function getDeviceOnboardingState(
  identity:Pick<ClientDeviceIdentity,'authorizationStatus'>|null,
  pairing:Pick<ClientDevicePairing,'currentStatus'>|null,
):DeviceOnboardingState{
  if(pairing?.currentStatus==='PENDING')return 'PENDING';
  if(pairing?.currentStatus==='EXPIRED')return 'EXPIRED';
  if(pairing?.currentStatus==='CANCELLED')return 'CANCELLED';
  if(identity?.authorizationStatus==='ACTIVE')return 'ACTIVE';
  if(identity?.authorizationStatus==='REVOKED')return 'REVOKED';
  return 'UNREGISTERED';
}
export async function requestPairingWithIdentityRotation(input:{
  identity:ClientDeviceIdentity;
  requestPairing(identity:ClientDeviceIdentity):Promise<PairingCreated>;
  onIdentityRotated?(identity:ClientDeviceIdentity):void;
}):Promise<{identity:ClientDeviceIdentity;pairing:PairingCreated}>{
  try{return {identity:input.identity,pairing:await input.requestPairing(input.identity)};}
  catch(problem){
    if(!problem||typeof problem!=='object'||!('code' in problem)||(problem as {code?:unknown}).code!=='DEVICE_REPAIR_REQUIRED')throw problem;
    const replacement=await rotateDeviceIdentity(input.identity.deviceId);
    if(!replacement)throw problem;
    input.onIdentityRotated?.(replacement);
    return {identity:replacement,pairing:await input.requestPairing(replacement)};
  }
}
const DB='comanview-device-identity',STORE='identity',KEY='primary',PAIRING_KEY='pairing';
function idb():any{return (globalThis as any).indexedDB;}
export async function loadDeviceIdentity():Promise<ClientDeviceIdentity|null>{
  if(!idb()) return null; const db=await open(); return new Promise((resolve,reject)=>{const r=db.transaction(STORE,'readonly').objectStore(STORE).get(KEY);r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error);});
}
export async function saveDeviceIdentity(value:ClientDeviceIdentity):Promise<void>{
  const db=await open(); await new Promise<void>((resolve,reject)=>{const r=db.transaction(STORE,'readwrite').objectStore(STORE).put(value,KEY);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});
}
export async function markDeviceAuthorizationStatus(
  expectedDeviceId:string,
  authorizationStatus:ClientDeviceAuthorizationStatus,
):Promise<ClientDeviceIdentity|null>{
  const db=await open();
  return new Promise<ClientDeviceIdentity|null>((resolve,reject)=>{
    const transaction=db.transaction(STORE,'readwrite');
    const store=transaction.objectStore(STORE);
    let updated:ClientDeviceIdentity|null=null;
    transaction.oncomplete=()=>resolve(updated);
    transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error);
    const read=store.get(KEY);
    read.onerror=()=>undefined;
    read.onsuccess=()=>{
      const current=read.result as ClientDeviceIdentity|undefined;
      if(!current||current.deviceId!==expectedDeviceId)return;
      updated={...current,authorizationStatus};
      store.put(updated,KEY);
    };
  });
}
export async function clearDeviceIdentity():Promise<void>{const db=await open();await new Promise<void>((resolve,reject)=>{const r=db.transaction(STORE,'readwrite').objectStore(STORE).delete(KEY);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});}
export async function loadDevicePairing():Promise<ClientDevicePairing|null>{
  if(!idb())return null;const db=await open();return new Promise((resolve,reject)=>{const r=db.transaction(STORE,'readonly').objectStore(STORE).get(PAIRING_KEY);r.onsuccess=()=>resolve(normalizePairing(r.result));r.onerror=()=>reject(r.error);});
}
export async function saveDevicePairing(
  value:ClientDevicePairing|PairingCreated,
  expectedCurrentPairingId?:string,
):Promise<boolean>{
  const normalized=normalizePairing(value);if(!normalized)return false;const db=await open();
  return new Promise<boolean>((resolve,reject)=>{const store=db.transaction(STORE,'readwrite').objectStore(STORE);
    const identity=store.get(KEY);identity.onerror=()=>reject(identity.error);identity.onsuccess=()=>{
      if(identity.result?.deviceId!==normalized.deviceId){resolve(false);return;}
      const write=()=>{const request=store.put(normalized,PAIRING_KEY);request.onsuccess=()=>resolve(true);request.onerror=()=>reject(request.error);};
      if(!expectedCurrentPairingId){write();return;}
      const current=store.get(PAIRING_KEY);current.onerror=()=>reject(current.error);current.onsuccess=()=>{
        if(normalizePairing(current.result)?.pairingId!==expectedCurrentPairingId){resolve(false);return;}
        write();
      };
    };});
}
export async function clearDevicePairing(expectedPairingId?:string):Promise<void>{const db=await open();await new Promise<void>((resolve,reject)=>{const store=db.transaction(STORE,'readwrite').objectStore(STORE);
  if(!expectedPairingId){const deletion=store.delete(PAIRING_KEY);deletion.onsuccess=()=>resolve();deletion.onerror=()=>reject(deletion.error);return;}
  const current=store.get(PAIRING_KEY);current.onerror=()=>reject(current.error);current.onsuccess=()=>{
    const pairing=normalizePairing(current.result);if(pairing?.pairingId!==expectedPairingId){resolve();return;}
    const deletion=store.delete(PAIRING_KEY);deletion.onsuccess=()=>resolve();deletion.onerror=()=>reject(deletion.error);
  };});}
export function createDeviceIdentity(type:DeviceType,displayName:string):ClientDeviceIdentity{
  const bytes=new Uint8Array(32);(globalThis as any).crypto.getRandomValues(bytes);
  const credential=Array.from(bytes,(b)=>String.fromCharCode(b)).join('');
  return {deviceId:uuidV7(),credential:(globalThis as any).btoa(credential).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''),type,displayName,authorizationStatus:'UNKNOWN'};
}
export async function rotateDeviceIdentity(expectedDeviceId:string):Promise<ClientDeviceIdentity|null>{
  const db=await open();
  return new Promise<ClientDeviceIdentity|null>((resolve,reject)=>{
    const transaction=db.transaction(STORE,'readwrite');
    const store=transaction.objectStore(STORE);
    let replacement:ClientDeviceIdentity|null=null;
    transaction.oncomplete=()=>resolve(replacement);
    transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error);
    const currentRequest=store.get(KEY);
    currentRequest.onerror=()=>undefined;
    currentRequest.onsuccess=()=>{
      const current=currentRequest.result as ClientDeviceIdentity|undefined;
      if(!current||current.deviceId!==expectedDeviceId)return;
      const pairingRequest=store.get(PAIRING_KEY);
      pairingRequest.onerror=()=>undefined;
      pairingRequest.onsuccess=()=>{
        replacement=createDeviceIdentity(current.type,current.displayName);
        const write=store.put(replacement,KEY);
        write.onerror=()=>undefined;
        write.onsuccess=()=>{
          const pairing=normalizePairing(pairingRequest.result);
          if(pairing?.deviceId!==expectedDeviceId)return;
          const deletion=store.delete(PAIRING_KEY);
          deletion.onerror=()=>undefined;
        };
      };
    };
  });
}
export function createClientDevicePairing(value:PairingCreated):ClientDevicePairing {
  return {pairingId:value.pairingId,requestToken:value.requestToken,pairingCode:value.pairingCode,
    expiresAt:value.expiresAt,deviceId:value.device.deviceId,currentStatus:'PENDING'};
}
export function createPairingAuthorizationData(
  pairing: Pick<ClientDevicePairing, 'pairingId' | 'pairingCode'>,
  identity: Pick<ClientDeviceIdentity, 'deviceId' | 'type' | 'displayName'>,
): PairingAuthorizationData {
  return PairingAuthorizationDataSchema.parse({
    schemaVersion: 1,
    pairingId: pairing.pairingId,
    pairingCode: pairing.pairingCode,
    deviceId: identity.deviceId,
    deviceType: identity.type,
    displayName: identity.displayName,
  });
}
export function serializePairingAuthorizationData(value: PairingAuthorizationData): string {
  return JSON.stringify(PairingAuthorizationDataSchema.parse(value), null, 2);
}
export function parsePairingAuthorizationData(value: string): PairingAuthorizationData {
  return PairingAuthorizationDataSchema.parse(JSON.parse(value) as unknown);
}
function uuidV7():string{const b=new Uint8Array(16);(globalThis as any).crypto.getRandomValues(b);let t=Date.now();for(let i=5;i>=0;i--){b[i]=t&255;t=Math.floor(t/256);}b[6]=(b[6]!&15)|112;b[8]=(b[8]!&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
function normalizePairing(value:any):ClientDevicePairing|null{
  if(!value||typeof value!=='object')return null;
  const deviceId=typeof value.deviceId==='string'?value.deviceId:value.device?.deviceId;
  const status=value.currentStatus??'PENDING';
  if(typeof value.pairingId!=='string'||typeof value.requestToken!=='string'||typeof value.pairingCode!=='string'||
    typeof value.expiresAt!=='string'||typeof deviceId!=='string'||!['PENDING','ACTIVE','EXPIRED','CANCELLED'].includes(status))return null;
  return {pairingId:value.pairingId,requestToken:value.requestToken,pairingCode:value.pairingCode,
    expiresAt:value.expiresAt,deviceId,currentStatus:status as PairingStatus};
}
function open():Promise<any>{return new Promise((resolve,reject)=>{const r=idb().open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
