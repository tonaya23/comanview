import { EntityId } from '@comanview/domain';
import type { NewAuditEntry,RestaurantAdministrationRepository } from '@comanview/database';
import type { RestaurantAdministrationCommand,RestaurantAdministrationState } from '@comanview/contracts';
import type { AuthenticatedActor } from '../../app/authContext.js';
import { AppError } from '../../app/errorHandler.js';
import type { EdgeLicenseManager } from '../licensing/EdgeLicenseManager.js';

const permissionByKind:Record<RestaurantAdministrationCommand['kind'],string>={
  UPDATE_BUSINESS_PROFILE:'BUSINESS_PROFILE_MANAGE',SET_BUSINESS_DAY_POLICY:'BUSINESS_DAY_POLICY_MANAGE',SET_CURRENCY:'CURRENCY_MANAGE',
  CREATE_CASH_REGISTER:'CASH_REGISTER_MANAGE',UPDATE_CASH_REGISTER:'CASH_REGISTER_MANAGE',CREATE_STATION:'STATION_MANAGE',UPDATE_STATION:'STATION_MANAGE',
  ASSIGN_PRODUCT_STATION:'STATION_MANAGE',CREATE_ZONE:'TABLE_MANAGE',UPDATE_ZONE:'TABLE_MANAGE',CREATE_TABLE:'TABLE_MANAGE',UPDATE_TABLE:'TABLE_MANAGE',
  SET_TIP_PREFERENCES:'TIP_PREFERENCES_MANAGE'};

export class AdministrationService{
  constructor(private repository:RestaurantAdministrationRepository,private binding:{tenantId:string;locationId:string;edgeId:string},private licensing:EdgeLicenseManager){}
  state():RestaurantAdministrationState{return this.repository.state(this.binding);}
  publicProfile(){const p=this.state().businessProfile;return{commercialName:p.commercialName,address:p.address,operatingHours:p.operatingHours,logo:p.logo,confirmed:p.confirmed};}
  execute(command:RestaurantAdministrationCommand,actor:AuthenticatedActor){
    if(actor.tenantId!==this.binding.tenantId||actor.locationId!==this.binding.locationId)throw new AppError('ADMINISTRATION_BINDING_MISMATCH',403,'La sesión no pertenece a esta instalación.');
    const required=permissionByKind[command.kind];if(!actor.permissions.includes(required as never))throw new AppError('PERMISSION_DENIED',403,`Permission ${required} is required.`);
    if(command.kind==='SET_TIP_PREFERENCES')this.assertTipPreferences(command.preferences);
    const audit:NewAuditEntry={auditId:EntityId.generate().toString(),occurredAt:new Date(),tenantId:actor.tenantId,locationId:actor.locationId,
      deviceId:actor.deviceId,sessionId:actor.sessionId,actorUserId:actor.userId,actorRole:actor.roles[0]??null,authorizedByUserId:null,authorizedByRole:null,
      action:'RESTAURANT_ADMINISTRATION_CHANGED',entityType:'OPERATIONAL_CONFIGURATION',entityId:this.binding.locationId,outcome:'SUCCESS',reason:command.reason,
      commandId:command.commandId,before:null,after:null,amountAffected:null,currency:null,eventId:null};
    try{return this.repository.execute(command,this.binding,audit);}catch(error){const code=error instanceof Error?error.message:'';
      if(/^(ADMINISTRATION_|BUSINESS_|CURRENCY_|CASH_REGISTER_|STATION_|ZONE_|TABLE_|PRODUCT_|COMMAND_)[A-Z_]*$/.test(code))
        throw new AppError(code,code.endsWith('_REQUIRED')||code.endsWith('_NOT_FOUND')?404:409,'La configuración no fue modificada.');throw error;}
  }
  operational(){const state=this.state();return state.operational;}
  effectiveTips(){const state=this.state(),legacy=this.licensing.currentConfiguration(),policy=legacy.tipPolicy,prefs=state.operational.tipPreferences;
    if(!policy)return{tipsEnabled:legacy.payment.tipsEnabled,percentageOptionsBasisPoints:legacy.payment.tipPercentageOptionsBasisPoints,fixedAmountEnabled:legacy.payment.tipsEnabled,ownerConfigurable:false};
    const configured=policy.ownerConfigurable?prefs:null;
    const allowed=policy.allowPercentages?policy.allowedPercentagesBasisPoints:[];
    const selected=configured?.percentageOptionsBasisPoints;
    const intersection=selected?.filter(value=>allowed.includes(value));
    // Retain stored intent, but never treat it as authority after a policy change.
    // If every formerly selected option was withdrawn, use current Cloud options.
    // An explicitly empty local selection remains empty.
    const percentages=intersection===undefined||Boolean(selected?.length&&!intersection.length)?allowed:intersection;
    return{tipsEnabled:(configured?.enabled??true)&&(policy.allowPercentages||policy.allowFixedAmount),
      percentageOptionsBasisPoints:percentages,
      fixedAmountEnabled:policy.allowFixedAmount&&(configured?.fixedAmountEnabled??true),ownerConfigurable:policy.ownerConfigurable};}
  private assertTipPreferences(p:{enabled:boolean;percentageOptionsBasisPoints:number[];fixedAmountEnabled:boolean}){const policy=this.licensing.currentConfiguration().tipPolicy;
    if(!policy||!policy.ownerConfigurable)throw new AppError('TIP_POLICY_NOT_DELEGATED',409,'Cloud no delegó preferencias de propina al Owner.');
    if((p.percentageOptionsBasisPoints.length&&!policy.allowPercentages)||p.percentageOptionsBasisPoints.some(x=>!policy.allowedPercentagesBasisPoints.includes(x))||
      (p.fixedAmountEnabled&&!policy.allowFixedAmount))throw new AppError('TIP_PREFERENCES_OUTSIDE_POLICY',409,'Las preferencias exceden la política firmada.');}
}
