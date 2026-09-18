import { EntityId } from '@comanview/domain';import type { NewAuditEntry,TaxAdministrationRepository } from '@comanview/database';
import type { AuthenticatedActor } from '../../app/authContext.js';import type { TaxAdministrationCommand } from '@comanview/contracts';import { AppError,parseContractErrorCode } from '../../app/errorHandler.js';
import type { AuthService } from '../auth/application/AuthService.js';
import { withProductAssignmentAuthorization,rethrowProductVersionConflict } from './productAssignmentAuthorization.js';
export class TaxAdministrationService{constructor(private repository:TaxAdministrationRepository,private binding:{tenantId:string;locationId:string;edgeId:string},private auth?:Pick<AuthService,'withCurrentAuthorization'>,private onCommitted?:(result:import('@comanview/contracts').TaxAdministrationResult)=>void){}
  state(){return this.repository.state(this.binding);}
  execute(command:TaxAdministrationCommand,actor:AuthenticatedActor){if(!actor.permissions.includes('TAX_PROFILE_MANAGE'))throw new AppError('PERMISSION_DENIED',403,'Tax administration permission required.');
    const audit:NewAuditEntry={auditId:EntityId.generate().toString(),occurredAt:new Date(),tenantId:actor.tenantId,locationId:actor.locationId,deviceId:actor.deviceId,sessionId:actor.sessionId,
      actorUserId:actor.userId,actorRole:actor.roles[0]??null,authorizedByUserId:null,authorizedByRole:null,action:'TAX_CONFIGURATION_CHANGED',entityType:'TAX_PROFILE',entityId:this.binding.locationId,
      outcome:'SUCCESS',reason:command.reason,commandId:command.commandId,before:null,after:null,amountAffected:null,currency:null,eventId:null};
    const execute=(authorize?:(epoch:number)=>void)=>{try{return this.repository.execute(command,this.binding,audit,authorize,this.onCommitted);}catch(error){rethrowProductVersionConflict(error);const rawCode=error instanceof Error?error.message:'',code=parseContractErrorCode(rawCode);if(code&&/^(CATALOG_|ADMINISTRATION_|TAX_|PRODUCT_|COMMAND_)/.test(code))throw new AppError(code,409,'La configuración fiscal no fue modificada.');throw error;}};
    return command.kind==='ASSIGN_PRODUCT_TAX_PROFILE'?withProductAssignmentAuthorization(this.auth,actor,this.binding,'TAX_PROFILE_MANAGE',execute):execute();}
}
