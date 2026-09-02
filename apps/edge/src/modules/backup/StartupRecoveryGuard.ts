import { stat } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { updateRecoverySecurityFloor,type RecoverySecurityStore } from './RecoverySecurityStore.js';

export type StartupDatabaseDisposition='FIRST_BOOT'|'NORMAL'|'RECOVERY_REQUIRED'|'RECOVERY_COMPLETED';

export async function assessStartupDatabase(dbPath:string,store:RecoverySecurityStore,
  establishedInstallationEvidence=false,enforceCurrentSchemaFloor=false):Promise<StartupDatabaseDisposition>{
  const floor=await store.load();
  if(floor.upgradeJournal||floor.recoveryState==='RECOVERY_IN_PROGRESS')return 'RECOVERY_REQUIRED';
  const exists=await stat(dbPath).then(x=>x.isFile()).catch((error:NodeJS.ErrnoException)=>{
    if(error.code==='ENOENT')return false;throw error;});
  if(!exists){
    if(!floor.installationEstablished&&!establishedInstallationEvidence)return 'FIRST_BOOT';
    await store.save(updateRecoverySecurityFloor(floor,{installationEstablished:true,recoveryState:'RECOVERY_REQUIRED'}));
    return 'RECOVERY_REQUIRED';
  }
  try{
    const sqlite=new Database(dbPath,{readonly:true,fileMustExist:true});
    try{const integrity=sqlite.pragma('quick_check') as Array<{quick_check:string}>;
      if(integrity.length!==1||integrity[0]?.quick_check!=='ok')throw new Error('SQLITE_CORRUPT');
      const hasRecoveryEpoch=Boolean(sqlite.prepare(`SELECT 1 FROM pragma_table_info('edge_installations')
        WHERE name='recovery_epoch'`).get());
      if(!floor.installationEstablished&&(establishedInstallationEvidence||enforceCurrentSchemaFloor)&&hasRecoveryEpoch)
        throw new Error('RECOVERY_SECURITY_STATE_MISSING');
      if(floor.installationEstablished){
        if(!floor.binding)throw new Error('RECOVERY_SECURITY_BINDING_MISSING');
        const binding=sqlite.prepare(`SELECT tenant_id tenantId,location_id locationId,edge_id edgeId
          FROM edge_installations WHERE singleton_key='PRIMARY'`).get() as
          {tenantId:string;locationId:string;edgeId:string}|undefined;
        if(!binding||binding.tenantId!==floor.binding.tenantId||binding.locationId!==floor.binding.locationId||
          binding.edgeId!==floor.binding.edgeId)throw new Error('RECOVERY_SECURITY_BINDING_MISMATCH');
      }}
    finally{sqlite.close();}
    return floor.recoveryState==='RECOVERY_REQUIRED'?'RECOVERY_REQUIRED':'NORMAL';
  }catch{
    await store.save(updateRecoverySecurityFloor(floor,{installationEstablished:
      floor.installationEstablished||establishedInstallationEvidence,recoveryState:'RECOVERY_REQUIRED'}));
    return 'RECOVERY_REQUIRED';
  }
}
