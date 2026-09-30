import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { AuthService } from '../auth/application/AuthService.js';
import type { AuthenticatedActor } from '../../app/authContext.js';
import { MemoryRecoverySecurityStore, DevelopmentRecoverySecurityStore,
  updateRecoverySecurityFloor, type RecoverySecurityStore } from '../backup/RecoverySecurityStore.js';
import { withProductAssignmentAuthorization } from './productAssignmentAuthorization.js';

const binding = {edgeId:randomUUID(),tenantId:randomUUID(),locationId:randomUUID()};
const actor:AuthenticatedActor = {...binding,userId:randomUUID(),deviceId:randomUUID(),sessionId:randomUUID(),
  displayName:'Fixture',roles:['OWNER'],permissions:['TAX_PROFILE_MANAGE','STATION_MANAGE']};
const opened:Database.Database[]=[];
afterEach(()=>{for(const db of opened.splice(0))db.close();});
function database(version:number) {
  const db=new Database(':memory:');opened.push(db);
  const root=fileURLToPath(new URL('../../../../../migrations/edge/',import.meta.url));
  for(const name of readdirSync(root).filter(n=>/^\d{4}_.*\.sql$/.test(n)&&Number(n.slice(0,4))<=version).sort())
    db.exec(readFileSync(join(root,name),'utf8'));
  return db;
}
async function floor(version:16|17|18, floorBinding=binding) {
  const store=new MemoryRecoverySecurityStore();
  await store.mutate(f=>updateRecoverySecurityFloor(f,{binding:floorBinding,installationEstablished:true,minimumSchemaVersion:version}));
  return store;
}
function invoke(db:Database.Database,store:RecoverySecurityStore,permission:'TAX_PROFILE_MANAGE'|'STATION_MANAGE',epoch=0) {
  const auth:Pick<AuthService,'withCurrentAuthorization'>={withCurrentAuthorization:(_actor,run)=>
    store.readConsistent!(f=>run(()=>actor,f))};
  return withProductAssignmentAuthorization(auth,actor,binding,permission,authorize=>db.transaction(()=>{
    authorize(epoch,db);
    // A visible sentinel makes fail-closed assertions cover absence of side effects.
    db.prepare("INSERT INTO categories(id,name) VALUES(?,'Authorized')").run(randomUUID());
    return 'authorized';
  }).immediate());
}
for(const permission of ['TAX_PROFILE_MANAGE','STATION_MANAGE'] as const) {
  it.each([16,17,18] as const)(`${permission}: schema %s and matching Floor NORMAL are authorized`,async version=>{
    await expect(invoke(database(version),await floor(version),permission)).resolves.toBe('authorized');
  });
  it.each(['floor-ahead','db-ahead','partial18','below-minimum','future','binding','epoch','recovery','restore','upgrade','missing'] as const)(
    `${permission}: %s fails closed`,async fault=>{
      const db=database(fault==='floor-ahead'?17:fault==='below-minimum'?15:18);
      const store=await floor(fault==='db-ahead'?17:18,fault==='binding'?{...binding,edgeId:randomUUID()}:binding);
      if(fault==='partial18')db.exec('ALTER TABLE modifier_options DROP COLUMN version');
      if(fault==='future')db.pragma('user_version=19');
      if(fault==='recovery'||fault==='restore'||fault==='upgrade')await store.mutate(f=>updateRecoverySecurityFloor(f,{recoveryState:fault==='recovery'?'RECOVERY_REQUIRED':'RECOVERY_IN_PROGRESS'}));
      const selected=fault==='missing'?new MemoryRecoverySecurityStore():store;
      const before=db.prepare('SELECT count(*) n FROM categories').get();
      await expect(invoke(db,selected,permission,fault==='epoch'?1:0)).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});
      expect(db.prepare('SELECT count(*) n FROM categories').get()).toEqual(before);
    });
}
it('corrupt durable Floor fails closed before the assignment callback',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cv-assignment-floor-'));
  try {
    const path=join(root,'floor.bin');await writeFile(path,'invalid protected floor');
    const db=database(18),before=db.prepare('SELECT count(*) n FROM categories').get();
    await expect(invoke(db,new DevelopmentRecoverySecurityStore(path),'TAX_PROFILE_MANAGE')).rejects.toThrow();
    expect(db.prepare('SELECT count(*) n FROM categories').get()).toEqual(before);
  } finally {await rm(root,{recursive:true,force:true});}
});
