import type Database from 'better-sqlite3';
import { PersonnelListSchema,PersonnelRecoveryContextSchema,CompleteBootstrapRequestSchema,type PersonnelMutation,type CompleteOwnerRecoveryRequest } from '@comanview/contracts';
import type { z } from 'zod';
import { performPersonnelSecurityOperation,type RecoverySecurityStore } from '../backup/RecoverySecurityStore.js';
import { personnelRestrictions,type StoredPersonnelSecurity } from './PersonnelSecurityModel.js';
import { trustedOwner } from './PersonnelSecurityOperation.js';
import type { EdgeLicenseManager } from '../licensing/EdgeLicenseManager.js';
import { AppError } from '../../app/errorHandler.js';

export class PersonnelService{
  constructor(private db:Database.Database,private store:RecoverySecurityStore,private licensing:EdgeLicenseManager,private publicKeyring:Readonly<Record<string,string>>){}
  async list(){
    const floor=await this.store.load();
    if(!floor.personnel)throw new AppError('PERSONNEL_SECURITY_NOT_INITIALIZED',503,'Personal pendiente de inicialización segura.');
    const rows=this.db.prepare(`SELECT id AS userId,display_name AS displayName,status,version,trust_domain_id AS trustDomainId,
      credential_revision AS credentialRevision,authorization_revision AS authorizationRevision FROM users WHERE tenant_id=? AND location_id=? ORDER BY display_name,id`)
      .all(floor.binding!.tenantId,floor.binding!.locationId) as Array<StoredPersonnelSecurity&{displayName:string;version:number}>;
    return PersonnelListSchema.parse({ownerRecoveryRequired:!trustedOwner(this.db,floor),users:rows.map(row=>({...row,
      roles:(this.db.prepare('SELECT r.name FROM user_roles ur JOIN roles r ON ur.role_id=r.id WHERE user_id=? ORDER BY r.name').all(row.userId) as Array<{name:string}>).map(r=>r.name),
      restrictions:personnelRestrictions(floor.personnel!,row)}))});
  }
  async mutate(sessionId:string,command:PersonnelMutation){
    await this.run(()=>performPersonnelSecurityOperation(this.store,{kind:'MUTATE',sqlite:this.db,sessionId,command}));
    return {completed:true as const};
  }
  async challenge(input:{deviceId:string;deviceCredential:string;pairingId:string|null;requestToken?:string|undefined}){
    await this.run(()=>performPersonnelSecurityOperation(this.store,{kind:'OWNER_CHALLENGE',sqlite:this.db,deviceId:input.deviceId,deviceCredential:input.deviceCredential,
      pairingId:input.pairingId,...(input.requestToken?{requestToken:input.requestToken}:{})}));
    const floor=await this.store.load(),p=floor.personnel!;
    return PersonnelRecoveryContextSchema.parse({...p.recoveryContext,tenantId:floor.binding!.tenantId,locationId:floor.binding!.locationId,
      trustDomainId:p.trustDomainId,accessGeneration:p.ownerRecoveryAccess.generation,...p.ownerRecoveryAccess.challenge});
  }
  async recover(request:CompleteOwnerRecoveryRequest){
    await this.run(()=>performPersonnelSecurityOperation(this.store,{kind:'RECOVER_OWNER',sqlite:this.db,request,publicKeyring:this.publicKeyring,licensing:this.licensing}));
    return {completed:true as const,loginRequired:true as const};
  }
  async bootstrap(request:z.infer<typeof CompleteBootstrapRequestSchema>){
    await this.run(()=>performPersonnelSecurityOperation(this.store,{kind:'BOOTSTRAP_OWNER',sqlite:this.db,request,publicKeyring:this.publicKeyring,licensing:this.licensing}));
  }
  private async run(operation:()=>Promise<void>){try{await operation();}catch(error){
    const code=error instanceof Error?error.message:'';
    if(/^(PERSONNEL_|OWNER_RECOVERY_|USER_|DEVICE_|AUTH_|PERMISSION_|COMMAND_|CONTRACTUAL_|INVALID_CREDENTIALS|RECOVERY_)[A-Z_]*$/.test(code))
      throw new AppError(code,code==='PERMISSION_DENIED'?403:409,'La operación de personal requiere revisión; no se concedieron permisos implícitos.');
    throw error;
  }}
}
