import { EntityId } from '@comanview/domain';import type { NewAuditEntry,TaxAdministrationRepository } from '@comanview/database';
import type { AuthenticatedActor } from '../../app/authContext.js';import type { TaxAdministrationCommand } from '@comanview/contracts';import { AppError,parseContractErrorCode } from '../../app/errorHandler.js';
export class TaxAdministrationService{constructor(private repository:TaxAdministrationRepository,private binding:{tenantId:string;locationId:string;edgeId:string}){}
  state(){return this.repository.state(this.binding);}
  execute(command:TaxAdministrationCommand,actor:AuthenticatedActor){if(!actor.permissions.includes('TAX_PROFILE_MANAGE'))throw new AppError('PERMISSION_DENIED',403,'Tax administration permission required.');
    const audit:NewAuditEntry={auditId:EntityId.generate().toString(),occurredAt:new Date(),tenantId:actor.tenantId,locationId:actor.locationId,deviceId:actor.deviceId,sessionId:actor.sessionId,
      actorUserId:actor.userId,actorRole:actor.roles[0]??null,authorizedByUserId:null,authorizedByRole:null,action:'TAX_CONFIGURATION_CHANGED',entityType:'TAX_PROFILE',entityId:this.binding.locationId,
      outcome:'SUCCESS',reason:command.reason,commandId:command.commandId,before:null,after:null,amountAffected:null,currency:null,eventId:null};
    try{return this.repository.execute(command,this.binding,audit);}catch(error){const rawCode=error instanceof Error?error.message:'',code=parseContractErrorCode(rawCode);if(code&&/^(ADMINISTRATION_|TAX_|PRODUCT_|COMMAND_)/.test(code))throw new AppError(code,409,'La configuración fiscal no fue modificada.');throw error;}}
}
