import { createCipheriv,createDecipheriv,createHash,randomBytes } from 'node:crypto';
import { createReadStream,createWriteStream } from 'node:fs';
import { mkdir,mkdtemp,readFile,rename,rm,stat,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename,join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import Database from 'better-sqlite3';
import { BackupManifestSchema,type BackupDestinationType,type BackupManifest,type BackupTrigger } from '@comanview/contracts';

export const BACKUP_FORMAT_VERSION=1 as const;
export const CURRENT_EDGE_SCHEMA_VERSION=14;
export const BACKUP_APPLICATION_VERSION='1V';
const MANIFEST='manifest.json',PAYLOAD='database.enc';

export interface SqliteBackupSource { backup(destinationFile:string):Promise<unknown> }
export interface ArtifactBinding {tenantId:string;locationId:string;edgeId:string;recoveryEpoch:number}

export async function createEncryptedBackupArtifact(input:{
  source:SqliteBackupSource;destinationDirectory:string;backupId:string;binding:ArtifactBinding;
  recoveryKey:string;trigger:BackupTrigger;destinationType:BackupDestinationType;businessDate:string|null;
  now?:Date;
  schemaVersion?:13|14;
}):Promise<{artifactPath:string;manifest:BackupManifest}> {
  const now=input.now??new Date();
  const schemaVersion=input.schemaVersion??CURRENT_EDGE_SCHEMA_VERSION;
  const temporary=await mkdtemp(join(tmpdir(),'comanview-backup-create-'));
  const artifactName=`${input.backupId}.cvbackup`;
  const finalPath=join(input.destinationDirectory,artifactName);
  const pendingPath=join(input.destinationDirectory,`.${artifactName}.${process.pid}.pending`);
  try{
    await mkdir(input.destinationDirectory,{recursive:true});
    const snapshot=join(temporary,'database.sqlite');
    await input.source.backup(snapshot);
    assertSqliteSnapshot(snapshot,input.binding,schemaVersion);
    const plaintextSize=(await stat(snapshot)).size;
    const core={formatVersion:BACKUP_FORMAT_VERSION,backupId:input.backupId,tenantId:input.binding.tenantId,
      locationId:input.binding.locationId,sourceEdgeId:input.binding.edgeId,recoveryEpoch:input.binding.recoveryEpoch,
      createdAt:now.toISOString(),applicationVersion:BACKUP_APPLICATION_VERSION,schemaVersion,
      businessDate:input.businessDate,trigger:input.trigger,destinationType:input.destinationType,
      plaintextSizeBytes:plaintextSize};
    const aad=Buffer.from(JSON.stringify(core),'utf8');
    const dek=randomBytes(32),payloadIv=randomBytes(12),wrappedDekIv=randomBytes(12);
    const recoveryKey=decodeRecoveryKey(input.recoveryKey);
    const wrapping=createCipheriv('aes-256-gcm',recoveryKey,wrappedDekIv);wrapping.setAAD(aad);
    const wrappedDek=Buffer.concat([wrapping.update(dek),wrapping.final()]);
    const wrappedDekTag=wrapping.getAuthTag();
    await mkdir(pendingPath,{recursive:false});
    const encryptedPath=join(pendingPath,PAYLOAD);
    const cipher=createCipheriv('aes-256-gcm',dek,payloadIv);cipher.setAAD(aad);
    await pipeline(createReadStream(snapshot),cipher,createWriteStream(encryptedPath,{mode:0o600}));
    const payloadTag=cipher.getAuthTag();
    const ciphertextSize=(await stat(encryptedPath)).size;
    const manifest=BackupManifestSchema.parse({...core,ciphertextSizeBytes:ciphertextSize,
      ciphertextSha256:await sha256File(encryptedPath),encryption:{algorithm:'AES-256-GCM',
        payloadIv:payloadIv.toString('base64url'),payloadTag:payloadTag.toString('base64url'),
        wrappedDekIv:wrappedDekIv.toString('base64url'),wrappedDekTag:wrappedDekTag.toString('base64url'),
        wrappedDek:wrappedDek.toString('base64url')}});
    await writeFile(join(pendingPath,MANIFEST),JSON.stringify(manifest),{encoding:'utf8',mode:0o600});
    const verified=await verifyEncryptedBackupArtifact({artifactPath:pendingPath,recoveryKey:input.recoveryKey,
      expectedBinding:input.binding,allowLegacyUpgradeSnapshot:schemaVersion===13});
    await verified.cleanup();
    await rename(pendingPath,finalPath);
    return {artifactPath:finalPath,manifest};
  }finally{
    await rm(temporary,{recursive:true,force:true}).catch(()=>undefined);
    await rm(pendingPath,{recursive:true,force:true}).catch(()=>undefined);
  }
}

export async function verifyEncryptedBackupArtifact(input:{artifactPath:string;recoveryKey:string;
  expectedBackupId?:string;expectedBinding?:Partial<ArtifactBinding>;stagingDirectory?:string;
  allowLegacyUpgradeSnapshot?:boolean}):Promise<{manifest:BackupManifest;stagedDatabasePath:string;cleanup():Promise<void>}> {
  const manifest=BackupManifestSchema.parse(JSON.parse(await readFile(join(input.artifactPath,MANIFEST),'utf8')));
  if(manifest.schemaVersion!==CURRENT_EDGE_SCHEMA_VERSION&&
    !(input.allowLegacyUpgradeSnapshot&&manifest.schemaVersion===13))throw new Error('BACKUP_INCOMPATIBLE');
  if(input.expectedBackupId&&manifest.backupId!==input.expectedBackupId)throw new Error('RECOVERY_BACKUP_INVALID');
  assertBinding(manifest,input.expectedBinding);
  const encryptedPath=join(input.artifactPath,PAYLOAD);
  if((await sha256File(encryptedPath))!==manifest.ciphertextSha256)throw new Error('BACKUP_HASH_MISMATCH');
  const temporary=input.stagingDirectory??await mkdtemp(join(tmpdir(),'comanview-backup-verify-'));
  if(input.stagingDirectory)await mkdir(temporary,{recursive:true});
  const stagedDatabasePath=join(temporary,`${basename(input.artifactPath)}.sqlite`);
  const core=manifestCore(manifest),aad=Buffer.from(JSON.stringify(core),'utf8');
  try{
    const unwrap=createDecipheriv('aes-256-gcm',decodeRecoveryKey(input.recoveryKey),
      Buffer.from(manifest.encryption.wrappedDekIv,'base64url'));
    unwrap.setAAD(aad);unwrap.setAuthTag(Buffer.from(manifest.encryption.wrappedDekTag,'base64url'));
    const dek=Buffer.concat([unwrap.update(Buffer.from(manifest.encryption.wrappedDek,'base64url')),unwrap.final()]);
    const decipher=createDecipheriv('aes-256-gcm',dek,Buffer.from(manifest.encryption.payloadIv,'base64url'));
    decipher.setAAD(aad);decipher.setAuthTag(Buffer.from(manifest.encryption.payloadTag,'base64url'));
    await pipeline(createReadStream(encryptedPath),decipher,createWriteStream(stagedDatabasePath,{mode:0o600}));
    if((await stat(stagedDatabasePath)).size!==manifest.plaintextSizeBytes)throw new Error('BACKUP_SIZE_MISMATCH');
    assertSqliteSnapshot(stagedDatabasePath,{tenantId:manifest.tenantId,locationId:manifest.locationId,
      edgeId:manifest.sourceEdgeId,recoveryEpoch:manifest.recoveryEpoch},manifest.schemaVersion);
    return {manifest,stagedDatabasePath,cleanup:()=>rm(temporary,{recursive:true,force:true})};
  }catch(error){await rm(temporary,{recursive:true,force:true}).catch(()=>undefined);throw error;}
}

function manifestCore(manifest:BackupManifest){return {formatVersion:manifest.formatVersion,backupId:manifest.backupId,
  tenantId:manifest.tenantId,locationId:manifest.locationId,sourceEdgeId:manifest.sourceEdgeId,
  recoveryEpoch:manifest.recoveryEpoch,createdAt:manifest.createdAt,applicationVersion:manifest.applicationVersion,
  schemaVersion:manifest.schemaVersion,businessDate:manifest.businessDate,trigger:manifest.trigger,
  destinationType:manifest.destinationType,plaintextSizeBytes:manifest.plaintextSizeBytes};}
function assertBinding(manifest:BackupManifest,expected?:Partial<ArtifactBinding>){
  if(!expected)return;
  if((expected.tenantId&&manifest.tenantId!==expected.tenantId)||
    (expected.locationId&&manifest.locationId!==expected.locationId)||
    (expected.edgeId&&manifest.sourceEdgeId!==expected.edgeId)||
    (expected.recoveryEpoch!==undefined&&manifest.recoveryEpoch!==expected.recoveryEpoch))
    throw new Error('RECOVERY_LOCATION_MISMATCH');
}
function assertSqliteSnapshot(path:string,binding:ArtifactBinding,schemaVersion:number){
  if(schemaVersion>CURRENT_EDGE_SCHEMA_VERSION)throw new Error('BACKUP_INCOMPATIBLE');
  const sqlite=new Database(path,{readonly:true,fileMustExist:true});
  try{
    const integrity=sqlite.pragma('integrity_check') as Array<{integrity_check:string}>;
    if(integrity.length!==1||integrity[0]?.integrity_check!=='ok')throw new Error('BACKUP_INTEGRITY_FAILED');
    const row=sqlite.prepare(`SELECT tenant_id tenantId,location_id locationId,edge_id edgeId,
      ${schemaVersion===13?'0':'recovery_epoch'} recoveryEpoch FROM edge_installations WHERE singleton_key='PRIMARY'`).get() as ArtifactBinding|undefined;
    if(!row||row.tenantId!==binding.tenantId||row.locationId!==binding.locationId||
      row.edgeId!==binding.edgeId||row.recoveryEpoch!==binding.recoveryEpoch)throw new Error('RECOVERY_LOCATION_MISMATCH');
  }finally{sqlite.close();}
}
function decodeRecoveryKey(value:string){const key=Buffer.from(value,'base64url');if(key.length!==32)throw new Error('RECOVERY_KEY_INVALID');return key;}
async function sha256File(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk as Buffer);return hash.digest('hex');}
