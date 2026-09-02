import { describe,expect,it } from 'vitest';
import { BackupManager,selectRetainedBackupIds } from './BackupManager.js';
import { MemoryRecoverySecurityStore } from './RecoverySecurityStore.js';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('backup retention',()=>{
  it('keeps 24 recent, 7 daily, 4 weekly buckets and always the latest verified backup',()=>{
    const base=Date.UTC(2026,8,1,12);
    const records=Array.from({length:60},(_,index)=>({backupId:`backup-${index}`,
      createdAt:new Date(base-index*12*60*60_000)}));
    const kept=selectRetainedBackupIds(records);
    expect(kept.has('backup-0')).toBe(true);
    expect(records.slice(0,24).every(row=>kept.has(row.backupId))).toBe(true);
    expect(kept.size).toBeGreaterThanOrEqual(24);
    expect(kept.size).toBeLessThanOrEqual(35);
    expect(selectRetainedBackupIds(records,['backup-59']).has('backup-59')).toBe(true);
  });
});
describe('backup and recovery concurrency',()=>{
  it('blocks ordinary backups behind the recovery preparation barrier',async()=>{
    const manager=new BackupManager({byCommand:()=>null} as any,{} as any,{} as any,{} as any,
      {tenantId:'tenant',locationId:'location',edgeId:'edge'},'backups',{info:()=>undefined,warn:()=>undefined});
    expect(manager.beginRecoveryPreparation()).toBe(true);expect(manager.beginRecoveryPreparation()).toBe(false);
    await expect(manager.create({commandId:'command',destinationType:'LOCAL',trigger:'MANUAL',actor:null}))
      .rejects.toMatchObject({code:'RECOVERY_IN_PROGRESS'});
    manager.cancelRecoveryPreparation();expect(manager.beginRecoveryPreparation()).toBe(true);
  });
  it('does not label the local backup directory as an off-device destination',async()=>{
    const manager=new BackupManager({} as any,{} as any,{} as any,{} as any,
      {tenantId:'tenant',locationId:'location',edgeId:'edge'},'backups',{info:()=>undefined,warn:()=>undefined});
    await expect(manager.configureOffDevice('backups','command',{} as any)).rejects.toMatchObject({
      code:'BACKUP_DESTINATION_UNAVAILABLE'});
  });
  it('returns a stable contextual error and preserves configuration when the destination is unavailable',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cv-off-device-'));
    try{
      const blocked=join(root,'not-a-directory');await writeFile(blocked,'fixture');
      const store=new MemoryRecoverySecurityStore();
      const manager=new BackupManager({} as any,{} as any,{} as any,store,
        {tenantId:'tenant',locationId:'location',edgeId:'edge'},join(root,'local'),{info:()=>undefined,warn:()=>undefined});
      await expect(manager.configureOffDevice(join(blocked,'child'),'command',{} as any)).rejects.toMatchObject({
        code:'BACKUP_DESTINATION_UNAVAILABLE',statusCode:409});
      expect((await store.load()).offDeviceDirectory).toBeNull();
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
