import { EntityId } from '@comanview/domain';
import { RecoveryAuthorizationConflictError,type CloudAdminMutationActor,type CloudRecoveryRepository } from '@comanview/database';
import type { CloudLicensingConfig } from '@comanview/config';
import { signRecoveryAuthorization } from '@comanview/licensing';

export class CloudRecoveryService {
  constructor(private repository:CloudRecoveryRepository,private signing:CloudLicensingConfig,
    private now:()=>Date=()=>new Date()){}
  async issue(input:{locationId:string;commandId:string;sourceEdgeId:string;targetEdgeId:string;backupId:string;reason:string},actor:CloudAdminMutationActor){
    const now=this.now(),authorizationId=EntityId.generate().toString(),epoch=await this.repository.nextEpoch(input.sourceEdgeId,input.targetEdgeId);
    const payload={formatVersion:1 as const,typ:'comanview-recovery-authorization' as const,authorizationId,
      tenantId:'00000000-0000-0000-0000-000000000000',locationId:'00000000-0000-0000-0000-000000000000',
      sourceEdgeId:input.sourceEdgeId,targetEdgeId:input.targetEdgeId,backupId:input.backupId,recoveryEpoch:epoch,
      purpose:'HARDWARE_REPLACEMENT_RESTORE' as const,issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+30*60_000).toISOString(),
      nonce:EntityId.generate().toString()};
    const binding=await this.repository.binding(input.sourceEdgeId,input.targetEdgeId);
    if(binding.locationId!==input.locationId)throw new RecoveryAuthorizationConflictError('RECOVERY_EDGE_BINDING_INVALID');
    const bound={...payload,tenantId:binding.tenantId,locationId:binding.locationId};
    const envelope=signRecoveryAuthorization(bound,this.signing.signingKid,this.signing.privateKeyPem);
    const {locationId:ignored,...request}=input;void ignored;
    const row=await this.repository.issue({...request,authorizationId,recoveryEpoch:epoch,kid:this.signing.signingKid,envelope,
      expiresAt:new Date(bound.expiresAt),actor,now});
    return {authorizationId:row.authorizationId,status:row.status,expiresAt:row.expiresAt.toISOString(),authorization:row.envelope};
  }
  consume(edgeId:string,input:{authorizationId:string;commandId:string;consumedAt:string}){
    return this.repository.consume(edgeId,{...input,consumedAt:new Date(input.consumedAt)});
  }
}
