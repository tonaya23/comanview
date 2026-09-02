import Database from 'better-sqlite3';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  createRecoverySecurityStore,
  initializeRecoverySecurityFloor,
} from './modules/backup/RecoverySecurityStore.js';

const options=parseOptions(process.argv.slice(2));
const action=required(options,'action');
const labRoot=resolve(required(options,'lab-root'));
const dbPath=resolve(required(options,'database'));
const securityPath=resolve(required(options,'security-path'));
const expectedDb=resolve(join(labRoot,'runtime','edge.db'));
const expectedSecurity=resolve(join(labRoot,'runtime','security-floor.bin'));

try{
  if(action!=='initialize'&&action!=='status')throw new Error('RECOVERY_LAB_ACTION_INVALID');
  assertInsideLab(labRoot,dbPath);
  assertInsideLab(labRoot,securityPath);
  if(!samePath(dbPath,expectedDb)||!samePath(securityPath,expectedSecurity))
    throw new Error('RECOVERY_LAB_UNSAFE_PATH');
  const sqlite=new Database(dbPath,{readonly:action==='status',fileMustExist:true});
  try{
    const integrity=sqlite.pragma('integrity_check') as Array<{integrity_check:string}>;
    if(integrity.length!==1||integrity[0]?.integrity_check!=='ok')throw new Error('RECOVERY_LAB_RUNTIME_INVALID');
    const binding=sqlite.prepare(`SELECT tenant_id tenantId,location_id locationId,edge_id edgeId,recovery_epoch recoveryEpoch
      FROM edge_installations WHERE singleton_key='PRIMARY'`).get() as
      {tenantId:string;locationId:string;edgeId:string;recoveryEpoch:number}|undefined;
    if(!binding)throw new Error('RECOVERY_LAB_RUNTIME_INVALID');
    const store=createRecoverySecurityStore({NODE_ENV:'production',COMANVIEW_RECOVERY_SECURITY_STORE:'windows-dpapi',
      COMANVIEW_RECOVERY_SECURITY_PATH:securityPath});
    const floor=action==='initialize'
      ?await initializeRecoverySecurityFloor({store,sqlite,binding})
      :await store.load();
    if(!floor.installationEstablished||floor.recoveryState!=='NORMAL'||!floor.binding||
      floor.binding.tenantId!==binding.tenantId||floor.binding.locationId!==binding.locationId||
      floor.binding.edgeId!==binding.edgeId||floor.recoveryEpoch!==binding.recoveryEpoch)
      throw new Error('RECOVERY_LAB_SECURITY_FLOOR_INVALID');
    console.log('SECURITY_FLOOR_READY = true');
  }finally{sqlite.close();}
}catch(error){
  const code=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'RECOVERY_LAB_SECURITY_FLOOR_FAILED';
  console.error('SECURITY_FLOOR_READY = false');
  console.error(`ERROR_CODE = ${code}`);
  process.exitCode=1;
}

function parseOptions(args:string[]):Map<string,string>{
  const result=new Map<string,string>();
  for(let index=0;index<args.length;index+=1){
    const current=args[index]!;
    if(current==='--')continue;
    if(!current.startsWith('--')||!args[index+1])throw new Error('RECOVERY_LAB_ARGUMENTS_INVALID');
    result.set(current.slice(2),args[index+1]!);index+=1;
  }
  return result;
}
function required(options:Map<string,string>,key:string):string{
  const value=options.get(key);if(!value)throw new Error('RECOVERY_LAB_ARGUMENTS_INVALID');return value;
}
function assertInsideLab(root:string,candidate:string):void{
  const value=relative(root,candidate);if(value===''||value.startsWith('..')||isAbsolute(value))
    throw new Error('RECOVERY_LAB_UNSAFE_PATH');
}
function samePath(left:string,right:string):boolean{
  const normalize=(value:string)=>process.platform==='win32'?resolve(value).toLocaleLowerCase('en-US'):resolve(value);
  return normalize(left)===normalize(right);
}
