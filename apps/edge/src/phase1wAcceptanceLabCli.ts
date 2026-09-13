/** Development/QA tooling for an isolated Phase 1W manual-acceptance installation. */
import Database from 'better-sqlite3';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Socket } from 'node:net';
import { createEdgeDatabase, SyncOutboxRepository } from '@comanview/database';
import { EdgeProvisioningClient } from './modules/provisioning/EdgeProvisioningClient.js';
import { WindowsDpapiEdgeSecretStore } from './modules/provisioning/EdgeSecretStore.js';
import { initializeRecoverySecurityFloor, WindowsDpapiRecoverySecurityStore } from './modules/backup/RecoverySecurityStore.js';
import { inspectAdministrationSchema } from '@comanview/database';
import { BASE_ROLE_PERMISSIONS } from '@comanview/auth';

type Action='create'|'start'|'status'|'stop'|'destroy'|'copy-cloud-password'|'cloud-off'|'verify-owner';
type Config={version:1;runId:string;root:string;container:string;databaseUrl:string;databasePassword:string;
  adminEmail:string;adminPassword:string;signingKid:string;privateKeyPem:string;publicKeyPem:string;
  tenantId:string;locationId:string;edgeId:string|null;credentialId:string|null;state:'CREATING'|'READY'};
type Runtime={processes:Record<string,number>;startedAt:string};
const args=new Map<string,string>();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i]!,process.argv[i+1]!);
let paths!:ReturnType<typeof labPaths>;const repo=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
async function main(){const action=args.get('--action') as Action|undefined,acceptanceRoot=args.get('--acceptance-root'),labRoot=args.get('--lab-root');
  if(!action||!acceptanceRoot||!labRoot)fail('ACCEPTANCE_LAB_ARGUMENTS_INVALID');paths=labPaths(acceptanceRoot,labRoot);try{
  if(action==='create')await create();
  else if(action==='start')await start();
  else if(action==='status')await status();
  else if(action==='verify-owner'){const db=new Database(paths.db,{readonly:true,fileMustExist:true});try{verifyAcceptanceOwner(db);out('OWNER_BASELINE_VALID',true);out('OWNER_ADMINISTRATION_VIEW',true);out('OWNER_CATALOG_VIEW',true);}finally{db.close();}}
  else if(action==='stop')await stop();
  else if(action==='destroy')await destroy();
  else if(action==='copy-cloud-password')copyCloudPassword();
  else if(action==='cloud-off')await cloudOff();
  else fail('ACCEPTANCE_LAB_ACTION_INVALID');
  }catch(error){process.stderr.write(`ERROR_CODE = ${code(error)}\nSTOP: preserve the isolated lab and report ERROR_CODE.\n`);process.exitCode=1;}}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();

export function labPaths(parent:string,root:string){
  const safeParent=resolve(parent),safeRoot=resolve(root),name=basename(safeRoot);
  if(!/^phase-1w-[a-z0-9][a-z0-9-]{0,31}$/.test(name)||dirname(safeRoot).toLowerCase()!==safeParent.toLowerCase()||
    relative(safeParent,safeRoot).startsWith('..'))throw new Error('ACCEPTANCE_LAB_UNSAFE_PATH');
  return{parent:safeParent,root:safeRoot,config:join(safeRoot,'lab-config.bin'),runtime:join(safeRoot,'runtime.json'),
    db:join(safeRoot,'edge','edge.db'),secret:join(safeRoot,'edge','edge-secret.bin'),floor:join(safeRoot,'edge','security-floor.bin'),
    backups:join(safeRoot,'edge','backups'),prints:join(safeRoot,'edge','print-debug'),logs:join(safeRoot,'logs'),
    postgres:join(safeRoot,'postgres'),browser:join(safeRoot,'browser-profile')};
}

async function create(){
  if(existsSync(paths.root))fail('ACCEPTANCE_LAB_ALREADY_EXISTS');
  for(const dir of [paths.root,dirname(paths.db),paths.backups,paths.prints,paths.logs,paths.postgres,paths.browser])mkdirSync(dir,{recursive:true});
  const keys=generateKeyPairSync('ed25519'),runId=basename(paths.root),databasePassword=randomBytes(32).toString('base64url');
  let config:Config={version:1,runId,root:paths.root,container:`comanview-${runId}`,databaseUrl:`postgresql://comanview_lab:${encodeURIComponent(databasePassword)}@127.0.0.1:55432/comanview_lab`,
    databasePassword,adminEmail:`${runId}@acceptance.invalid`,adminPassword:randomBytes(32).toString('base64url'),signingKid:`${runId}-key`,
    privateKeyPem:keys.privateKey.export({format:'pem',type:'pkcs8'}).toString(),publicKeyPem:keys.publicKey.export({format:'pem',type:'spki'}).toString(),
    tenantId:randomUUID(),locationId:randomUUID(),edgeId:null,credentialId:null,state:'CREATING'};
  saveConfig(config);
  docker(['run','-d','--name',config.container,'-e','POSTGRES_DB=comanview_lab','-e','POSTGRES_USER=comanview_lab',
    '-e',`POSTGRES_PASSWORD=${config.databasePassword}`,'-p','127.0.0.1:55432:5432','-v',`${paths.postgres}:/var/lib/postgresql`,'postgres:18']);
  await waitForStablePostgres(config.container);
  command('pnpm.cmd',['--filter','@comanview/database','cloud:migrate'],repo,{DATABASE_URL:config.databaseUrl});
  const cloudPid=launchNode(join(repo,'apps/cloud-api'),'src/index.ts',cloudEnvironment(config),'cloud-prepare');
  try{
    await waitForHealth('http://127.0.0.1:4000/health','ACCEPTANCE_LAB_CLOUD_NOT_READY');
    const cookie=await login(config);const headers={origin:'http://127.0.0.1:4000',cookie};
    await admin('/admin/v1/tenants',{commandId:randomUUID(),tenantId:config.tenantId,displayName:`Acceptance ${config.runId}`},headers);
    await admin(`/admin/v1/tenants/${config.tenantId}/locations`,{commandId:randomUUID(),locationId:config.locationId,
      displayName:'1W Acceptance Location',timezone:'America/Matamoros'},headers);
    const plan=await admin('/admin/v1/plans',{commandId:randomUUID(),code:`QA_${config.runId.replaceAll('-','_').toUpperCase()}`,
      displayName:'1W Acceptance',capabilities:['CORE_POS','TABLE_SERVICE','KDS','PRINTING'],deviceLimits:{POS:5,WAITER:5,KDS:5},reason:'Isolated 1W acceptance'},headers) as {planId:string};
    const configuration={payment:{tipsEnabled:true,tipPercentageOptionsBasisPoints:[1000,1500,2000]},
      tipPolicy:{ownerConfigurable:true,allowPercentages:true,allowedPercentagesBasisPoints:[1000,1500,2000],allowFixedAmount:true}};
    await admin(`/admin/v1/locations/${config.locationId}/license`,{commandId:randomUUID(),expectedRevision:0,planId:plan.planId,
      declaredState:'ACTIVE',configuration,reason:'Isolated 1W acceptance'},headers,'PUT');
    const issued=await admin(`/admin/v1/locations/${config.locationId}/provisioning-codes`,{commandId:randomUUID()},headers) as {code:string};
    createAcceptanceSchema14(paths.db);
    const edgeDatabase=createEdgeDatabase(paths.db);
    try{
      const client=new EdgeProvisioningClient(new SyncOutboxRepository(edgeDatabase.db),new WindowsDpapiEdgeSecretStore(paths.secret),'http://127.0.0.1:4000');
      const edge=await client.provision(issued.code);config={...config,edgeId:edge.edgeId,state:'READY'};
      const identity=new SyncOutboxRepository(edgeDatabase.db).findIdentity();config.credentialId=identity?.credentialId??null;
      if(!identity)fail('ACCEPTANCE_LAB_IDENTITY_MISSING');
      await initializeRecoverySecurityFloor({store:new WindowsDpapiRecoverySecurityStore(paths.floor),sqlite:edgeDatabase.sqlite,
        binding:{edgeId:identity.edgeId,tenantId:identity.tenantId,locationId:identity.locationId}});
    }finally{edgeDatabase.close();}
    saveConfig(config);
  }finally{killTree(cloudPid);dockerOptional(['stop',config.container]);}
  await status();
}

async function start(){
  const config=loadConfig();if(config.state!=='READY'||!config.edgeId||!config.credentialId)fail('ACCEPTANCE_LAB_NOT_READY');
  if(existsSync(paths.runtime))fail('ACCEPTANCE_LAB_ALREADY_RUNNING');
  for(const port of [3000,4000,5173,5174,5175,5176])if(await portOpen(port))fail(`ACCEPTANCE_LAB_PORT_${port}_IN_USE`);
  docker(['start',config.container]);await waitForStablePostgres(config.container);
  const processes:Record<string,number>={};
  try{
    processes['cloud']=launchNode(join(repo,'apps/cloud-api'),'src/index.ts',cloudEnvironment(config),'cloud');
    await waitForHealth('http://127.0.0.1:4000/health','ACCEPTANCE_LAB_CLOUD_NOT_READY');
    processes['edge']=launchNode(join(repo,'apps/edge'),'src/index.ts',edgeEnvironment(config),'edge');
    await waitForHealth('http://127.0.0.1:3000/health','ACCEPTANCE_LAB_EDGE_NOT_READY',90_000);
    const floor=loadFloorReadOnly();
    const sqlite=new Database(paths.db,{readonly:true,fileMustExist:true});
    try{if(inspectAdministrationSchema(sqlite)!==15||!floor.binding||floor.binding.edgeId!==config.edgeId||
      floor.binding.tenantId!==config.tenantId||floor.binding.locationId!==config.locationId||floor.recoveryState!=='NORMAL'||
       floor.personnel?.initializationState!=='ACTIVE')fail('ACCEPTANCE_LAB_STARTUP_VALIDATION_FAILED');
      if(sqlite.prepare("SELECT 1 FROM installation_state WHERE bootstrap_status='COMPLETED'").get())verifyAcceptanceOwner(sqlite);}
    finally{sqlite.close();}
    processes['pos']=launchPnpm(join(repo,'apps/pos'),['exec','vite'],'pos');
    processes['waiter']=launchPnpm(join(repo,'apps/waiter'),['exec','vite'],'waiter');
    processes['kds']=launchPnpm(join(repo,'apps/kds'),['exec','vite'],'kds');
    processes['superAdmin']=launchPnpm(join(repo,'apps/super-admin'),['exec','vite'],'super-admin');
    await Promise.all([waitForHealth('http://127.0.0.1:5173','ACCEPTANCE_LAB_POS_NOT_READY'),
      waitForHealth('http://127.0.0.1:5174','ACCEPTANCE_LAB_KDS_NOT_READY'),waitForHealth('http://127.0.0.1:5175','ACCEPTANCE_LAB_WAITER_NOT_READY'),
      waitForHealth('http://127.0.0.1:5176','ACCEPTANCE_LAB_SUPER_ADMIN_NOT_READY')]);
    writeFileSync(paths.runtime,JSON.stringify({processes,startedAt:new Date().toISOString()} satisfies Runtime),{mode:0o600});
    await status();
  }catch(error){for(const pid of Object.values(processes).reverse())killTree(pid);dockerOptional(['stop',config.container]);throw error;}
}

async function status(){
  const config=loadConfig(),runtime=loadRuntime();let schema:number|null=null,financialActivity:number|null=null,bindingOk=false,floor=false;
  if(existsSync(paths.db)){const db=new Database(paths.db,{readonly:true,fileMustExist:true});try{
    const names=new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name:string}>).map(x=>x.name));
    schema=names.has('personnel_security_intents')?15:names.has('backup_records')?14:names.has('installation_state')?13:null;
    const identity=db.prepare('SELECT edge_id edgeId,tenant_id tenantId,location_id locationId FROM edge_installations').get() as {edgeId:string;tenantId:string;locationId:string}|undefined;
    bindingOk=Boolean(identity&&identity.edgeId===config.edgeId&&identity.tenantId===config.tenantId&&identity.locationId===config.locationId);
    financialActivity=(db.prepare('SELECT (SELECT COUNT(*) FROM orders)+(SELECT COUNT(*) FROM payments)+(SELECT COUNT(*) FROM cash_sessions)+(SELECT COUNT(*) FROM cash_movements) n').get() as {n:number}).n;
  }finally{db.close();}}
  if(existsSync(paths.floor)){const value=loadFloorReadOnly();floor=Boolean(value.binding&&value.binding.edgeId===config.edgeId&&value.binding.tenantId===config.tenantId&&value.binding.locationId===config.locationId);}
  out('LAB_READY',config.state==='READY');out('RUN_ID',config.runId);out('ROOT',paths.root);out('EDGE_ID',config.edgeId);out('TENANT_ID',config.tenantId);out('LOCATION_ID',config.locationId);
  out('SCHEMA',schema);out('BINDING_CONSISTENT',bindingOk);out('SECURITY_FLOOR_PRESENT',floor);out('FINANCIAL_ACTIVITY_ROWS',financialActivity);out('RUNNING',Boolean(runtime));
  if(runtime){out('POS_URL','http://127.0.0.1:5173');out('WAITER_URL','http://127.0.0.1:5175');out('KDS_URL','http://127.0.0.1:5174');out('SUPER_ADMIN_URL','http://127.0.0.1:5176');out('CLOUD_RUNNING',Boolean(runtime.processes['cloud']));out('CLOUD_ADMIN_EMAIL',config.adminEmail);out('BROWSER_PROFILE',paths.browser);}
}
async function stop(){const runtime=loadRuntime();if(runtime)for(const pid of Object.values(runtime.processes).reverse())killTree(pid);if(existsSync(paths.runtime))rmSync(paths.runtime,{force:true});
  if(existsSync(`${paths.floor}.lock`))await new Promise(resolveWait=>setTimeout(resolveWait,12_000));
  const config=loadConfig();dockerOptional(['stop',config.container]);out('LAB_STOPPED',true);}
async function destroy(){const config=loadConfig();await stop();dockerOptional(['rm','-f',config.container]);const exact=resolve(paths.root);if(dirname(exact).toLowerCase()!==paths.parent.toLowerCase())fail('ACCEPTANCE_LAB_UNSAFE_PATH');rmSync(exact,{recursive:true,force:true});out('LAB_DESTROYED',true);}
function copyCloudPassword(){const config=loadConfig();const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','$v=[Console]::In.ReadToEnd();Set-Clipboard -Value $v'],{input:config.adminPassword,windowsHide:true});if(result.status!==0)fail('ACCEPTANCE_LAB_CLIPBOARD_FAILED');out('CLOUD_ADMIN_PASSWORD_COPIED',true);}
async function cloudOff(){const runtime=loadRuntime();if(!runtime)fail('ACCEPTANCE_LAB_NOT_RUNNING');const db=new Database(paths.db,{readonly:true,fileMustExist:true});try{const ready=db.prepare("SELECT 1 FROM installation_state WHERE singleton_key='PRIMARY' AND bootstrap_status='COMPLETED'").get();const license=db.prepare("SELECT 1 FROM edge_control_documents WHERE document_type='LICENSE' AND is_current=1").get();if(!ready||!license)fail('ACCEPTANCE_LAB_BOOTSTRAP_NOT_COMPLETE');}finally{db.close();}if(runtime.processes['cloud']){killTree(runtime.processes['cloud']);delete runtime.processes['cloud'];}dockerOptional(['stop',loadConfig().container]);writeFileSync(paths.runtime,JSON.stringify(runtime),{mode:0o600});out('CLOUD_OFFLINE',true);}

export function createAcceptanceSchema14(path:string){const db=new Database(path);try{const dir=join(repo,'migrations/edge');for(const file of readdirSync(dir).filter(x=>/^\d{4}_.*\.sql$/.test(x)&&Number(x.slice(0,4))<=14).sort())db.exec(readFileSync(join(dir,file),'utf8'));db.pragma('user_version=14');}finally{db.close();}}
/** Read-only gate after the human completes signed pairing/OWNER bootstrap. */
export function verifyAcceptanceOwner(db:Database.Database):void{
  const owner=db.prepare(`SELECT u.id FROM installation_state i JOIN users u ON u.id=i.initial_owner_user_id
    JOIN edge_installations e ON e.singleton_key=i.singleton_key
    WHERE i.singleton_key='PRIMARY' AND i.bootstrap_status='COMPLETED' AND u.status='ACTIVE'
      AND u.tenant_id=e.tenant_id AND u.location_id=e.location_id`).get() as {id:string}|undefined;
  if(!owner)throw new Error('ACCEPTANCE_LAB_OWNER_NOT_READY');
  const grants=db.prepare(`SELECT rp.permission_code code FROM user_roles ur JOIN roles r ON r.id=ur.role_id
    JOIN role_permissions rp ON rp.role_id=r.id WHERE ur.user_id=? AND r.name='OWNER'`).all(owner.id) as Array<{code:string}>;
  const codes=new Set(grants.map(x=>x.code));
  if(BASE_ROLE_PERMISSIONS.OWNER.some(permission=>!codes.has(permission)))throw new Error('ACCEPTANCE_LAB_OWNER_BASELINE_INCOMPLETE');
}
function cloudEnvironment(c:Config){return{NODE_ENV:'development',DATABASE_URL:c.databaseUrl,COMANVIEW_CLOUD_PORT:'4000',COMANVIEW_CLOUD_HOST:'127.0.0.1',COMANVIEW_CLOUD_DEV_ADMIN_EMAIL:c.adminEmail,COMANVIEW_CLOUD_DEV_ADMIN_PASSWORD:c.adminPassword,COMANVIEW_CLOUD_DEV_ADMIN_ROLE:'PLATFORM_ADMIN',COMANVIEW_CLOUD_SIGNING_KID:c.signingKid,COMANVIEW_CLOUD_SIGNING_PRIVATE_KEY_PEM:c.privateKeyPem};}
function edgeEnvironment(c:Config){return{NODE_ENV:'production',COMANVIEW_EDGE_DB_PATH:paths.db,COMANVIEW_EDGE_SECRET_STORE:'windows-dpapi',COMANVIEW_EDGE_SECRET_PATH:paths.secret,COMANVIEW_RECOVERY_SECURITY_STORE:'windows-dpapi',COMANVIEW_RECOVERY_SECURITY_PATH:paths.floor,COMANVIEW_BACKUP_LOCAL_DIR:paths.backups,COMANVIEW_DEBUG_PRINT_DIR:paths.prints,COMANVIEW_CLOUD_URL:'http://127.0.0.1:4000',COMANVIEW_SYNC_ENABLED:'true',COMANVIEW_EDGE_SCHEMA_VERSION:'15',COMANVIEW_LICENSE_ENFORCEMENT_ENABLED:'true',COMANVIEW_LICENSE_PUBLIC_KEYRING:JSON.stringify({[c.signingKid]:c.publicKeyPem}),COMANVIEW_CONTROL_PULL_INTERVAL_MS:'5000',COMANVIEW_HEARTBEAT_INTERVAL_MS:'30000'};}
async function login(c:Config){const response=await fetch('http://127.0.0.1:4000/admin/v1/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:4000'},body:JSON.stringify({email:c.adminEmail,password:c.adminPassword})});if(!response.ok)fail('ACCEPTANCE_LAB_CLOUD_LOGIN_FAILED');const cookie=response.headers.get('set-cookie')?.split(';')[0];if(!cookie)fail('ACCEPTANCE_LAB_CLOUD_COOKIE_MISSING');return cookie;}
async function admin(path:string,body:unknown,headers:{origin:string;cookie:string},method='POST'){const response=await fetch(`http://127.0.0.1:4000${path}`,{method,headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)});const value=await response.json().catch(()=>null);if(!response.ok)throw new Error(`ACCEPTANCE_LAB_CLOUD_HTTP_${response.status}`);return value;}
function launchNode(cwd:string,entry:string,extra:Record<string,string>,name:string){return launch(process.execPath,['--import','tsx',entry],cwd,extra,name);}
function launchPnpm(cwd:string,_argv:string[],name:string){return launch(process.execPath,[join(cwd,'node_modules/vite/bin/vite.js')],cwd,{},name);}
function launch(exe:string,argv:string[],cwd:string,extra:Record<string,string>,name:string){mkdirSync(paths.logs,{recursive:true});const outFd=openSync(join(paths.logs,`${name}.log`),'a'),errFd=openSync(join(paths.logs,`${name}.error.log`),'a');try{const child=spawn(exe,argv,{cwd,env:{...process.env,...extra},detached:true,windowsHide:true,stdio:['ignore',outFd,errFd]});child.unref();if(!child.pid)fail('ACCEPTANCE_LAB_PROCESS_START_FAILED');return child.pid;}finally{closeSync(outFd);closeSync(errFd);}}
function command(exe:string,argv:string[],cwd:string,extra:Record<string,string>){const windows=process.platform==='win32'&&exe.endsWith('.cmd');const result=spawnSync(windows?(process.env['ComSpec']??'cmd.exe'):exe,windows?['/d','/s','/c',exe,...argv]:argv,{cwd,env:{...process.env,...extra},stdio:'inherit',windowsHide:true});if(result.error)fail('ACCEPTANCE_LAB_COMMAND_SPAWN_FAILED');if(result.status!==0)fail('ACCEPTANCE_LAB_COMMAND_FAILED');}
function docker(argv:string[]){const result=spawnSync('docker',argv,{encoding:'utf8',windowsHide:true});if(result.status!==0)throw new Error('ACCEPTANCE_LAB_DOCKER_FAILED');return result.stdout.trim();}function dockerOptional(argv:string[]){spawnSync('docker',argv,{windowsHide:true,stdio:'ignore'});}function dockerOk(argv:string[]){return spawnSync('docker',argv,{windowsHide:true,stdio:'ignore'}).status===0;}
function postgresReady(container:string){return dockerOk(['exec',container,'psql','-U','comanview_lab','-d','comanview_lab','-tAc','SELECT 1']);}
async function waitForStablePostgres(container:string){let consecutive=0;await waitFor(async()=>{if(postgresReady(container))consecutive+=1;else consecutive=0;return consecutive>=8;},60_000,'ACCEPTANCE_LAB_POSTGRES_NOT_READY');}
function killTree(pid:number){if(Number.isSafeInteger(pid)&&pid>0)spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}
async function waitForHealth(url:string,error:string,timeout=60_000){await waitFor(async()=>{try{return (await fetch(url)).ok;}catch{return false;}},timeout,error);}
async function waitFor(check:()=>boolean|Promise<boolean>,timeout:number,error:string){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,500));}fail(error);}
function portOpen(port:number){return new Promise<boolean>(resolveResult=>{const socket=new Socket();socket.once('connect',()=>{socket.destroy();resolveResult(true);});socket.once('error',()=>resolveResult(false));socket.connect(port,'127.0.0.1');});}
function saveConfig(value:Config){writeFileSync(paths.config,dpapi('Protect',Buffer.from(JSON.stringify(value))),{mode:0o600});}function loadConfig():Config{if(!existsSync(paths.config))fail('ACCEPTANCE_LAB_NOT_CREATED');return JSON.parse(dpapi('Unprotect',readFileSync(paths.config)).toString('utf8')) as Config;}
function dpapi(operation:'Protect'|'Unprotect',input:Buffer){const script=`Add-Type -AssemblyName System.Security;$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());$o=[Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($o))`;const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{input:input.toString('base64'),encoding:'utf8',windowsHide:true});if(result.status!==0)fail('ACCEPTANCE_LAB_DPAPI_FAILED');return Buffer.from(result.stdout.trim(),'base64');}
function loadFloorReadOnly(){const value=JSON.parse(dpapi('Unprotect',readFileSync(paths.floor)).toString('utf8')) as {checksum:string;binding?:{edgeId:string;tenantId:string;locationId:string};recoveryState?:string;personnel?:{initializationState?:string}};const {checksum,...body}=value;if(createHash('sha256').update(JSON.stringify(body)).digest('hex')!==checksum)fail('ACCEPTANCE_LAB_FLOOR_CHECKSUM_INVALID');return value;}
function loadRuntime(){if(!existsSync(paths.runtime))return null;return JSON.parse(readFileSync(paths.runtime,'utf8')) as Runtime;}
function out(name:string,value:unknown){process.stdout.write(`${name} = ${value??'null'}\n`);}function fail(value:string):never{throw new Error(value);}function code(error:unknown){const value=error instanceof Error?error.message:'ACCEPTANCE_LAB_FAILED';return /^[A-Z][A-Z0-9_]+$/.test(value)?value:'ACCEPTANCE_LAB_FAILED';}
