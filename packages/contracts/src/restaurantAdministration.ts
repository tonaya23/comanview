import { z } from 'zod';

const Uuid = z.string().uuid();
const Version = z.number().int().nonnegative();
const Command = z.object({ commandId: z.string().min(1).max(120), expectedVersion: Version,
  reason: z.string().trim().min(3).max(500) });
const Address = z.object({ line1:z.string().trim().max(160).default(''),line2:z.string().trim().max(160).default(''),
  city:z.string().trim().max(100).default(''),region:z.string().trim().max(100).default(''),postalCode:z.string().trim().max(30).default(''),
  countryCode:z.string().trim().regex(/^[A-Z]{2}$/).nullable().default(null) }).strict();
const Hours = z.array(z.object({day:z.number().int().min(0).max(6),closed:z.boolean(),open:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  close:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable()}).strict().superRefine((v,c)=>{if(v.closed&&(v.open!==null||v.close!==null))c.addIssue({code:'custom',message:'Closed day cannot include hours'});
    if(!v.closed&&(!v.open||!v.close))c.addIssue({code:'custom',message:'Open day requires open and close'})})).max(14).superRefine((v,c)=>{if(new Set(v.map(x=>x.day)).size!==v.length)c.addIssue({code:'custom',message:'Duplicate operating day'});});
const Logo = z.object({base64:z.string().max(1_500_000),mime:z.enum(['image/png','image/jpeg']),width:z.number().int().min(1).max(2048),
  height:z.number().int().min(1).max(2048)}).strict().nullable();
const TipPreferences = z.object({enabled:z.boolean(),percentageOptionsBasisPoints:z.array(z.number().int().min(0).max(10_000)).max(12),
  fixedAmountEnabled:z.boolean()}).strict();

export const RestaurantAdministrationCommandSchema=z.discriminatedUnion('kind',[
  Command.extend({kind:z.literal('UPDATE_BUSINESS_PROFILE'),commercialName:z.string().trim().min(1).max(160),legalName:z.string().trim().max(200).nullable(),
    phone:z.string().trim().max(40).nullable(),email:z.string().trim().email().max(200).nullable(),address:Address,operatingHours:Hours,logo:Logo,confirmed:z.literal(true)}).strict(),
  Command.extend({kind:z.literal('SET_BUSINESS_DAY_POLICY'),timeZone:z.string().trim().min(1).max(100),rollover:z.string().regex(/^\d{2}:\d{2}$/)}).strict(),
  Command.extend({kind:z.literal('SET_CURRENCY'),currency:z.string().regex(/^[A-Z]{3}$/)}).strict(),
  Command.extend({kind:z.literal('CREATE_CASH_REGISTER'),name:z.string().trim().min(1).max(100),blindCashCount:z.boolean(),makeDefault:z.boolean(),displayOrder:z.number().int()}).strict(),
  Command.extend({kind:z.literal('UPDATE_CASH_REGISTER'),cashRegisterId:Uuid,name:z.string().trim().min(1).max(100),active:z.boolean(),blindCashCount:z.boolean(),makeDefault:z.boolean(),displayOrder:z.number().int()}).strict(),
  Command.extend({kind:z.literal('CREATE_STATION'),name:z.string().trim().min(1).max(100),purpose:z.string().trim().max(100).nullable(),kdsVisible:z.boolean(),displayOrder:z.number().int()}).strict(),
  Command.extend({kind:z.literal('UPDATE_STATION'),stationId:Uuid,name:z.string().trim().min(1).max(100),purpose:z.string().trim().max(100).nullable(),kdsVisible:z.boolean(),active:z.boolean(),displayOrder:z.number().int()}).strict(),
  Command.extend({kind:z.literal('ASSIGN_PRODUCT_STATION'),productId:Uuid,stationId:Uuid.nullable()}).strict(),
  Command.extend({kind:z.literal('CREATE_ZONE'),name:z.string().trim().min(1).max(100),displayOrder:z.number().int()}).strict(),
  Command.extend({kind:z.literal('UPDATE_ZONE'),zoneId:Uuid,name:z.string().trim().min(1).max(100),active:z.boolean(),displayOrder:z.number().int()}).strict(),
  Command.extend({kind:z.literal('CREATE_TABLE'),zoneId:Uuid,name:z.string().trim().min(1).max(100),capacity:z.number().int().positive().nullable(),displayOrder:z.number().int()}).strict(),
  Command.extend({kind:z.literal('UPDATE_TABLE'),tableId:Uuid,zoneId:Uuid,name:z.string().trim().min(1).max(100),capacity:z.number().int().positive().nullable(),active:z.boolean(),displayOrder:z.number().int()}).strict(),
  Command.extend({kind:z.literal('SET_TIP_PREFERENCES'),preferences:TipPreferences}).strict(),
]);
export type RestaurantAdministrationCommand=z.infer<typeof RestaurantAdministrationCommandSchema>;
export const RestaurantAdministrationResultSchema=z.object({entityId:Uuid,version:z.number().int().positive()});
export type RestaurantAdministrationResult=z.infer<typeof RestaurantAdministrationResultSchema>;

export const RestaurantAdministrationStateSchema=z.object({
  businessProfile:z.object({commercialName:z.string().nullable(),legalName:z.string().nullable(),phone:z.string().nullable(),email:z.string().nullable(),
    address:Address,operatingHours:Hours,logo:z.object({mime:z.enum(['image/png','image/jpeg']),width:z.number(),height:z.number(),base64:z.string()}).nullable(),confirmed:z.boolean(),version:z.number()}),
  operational:z.object({timeZone:z.string().nullable(),rollover:z.string().nullable(),businessDayVersion:z.number(),currency:z.string().nullable(),currencyLocked:z.boolean(),
    defaultCashRegisterId:Uuid.nullable(),defaultTaxProfileId:Uuid.nullable(),fiscalPolicyVersion:z.number(),tipPreferences:TipPreferences.nullable(),version:z.number()}),
  cashRegisters:z.array(z.object({id:Uuid,name:z.string(),currency:z.string(),active:z.boolean(),blindCashCount:z.boolean(),displayOrder:z.number(),version:z.number()})),
  stations:z.array(z.object({id:Uuid,name:z.string(),purpose:z.string().nullable(),kdsVisible:z.boolean(),active:z.boolean(),displayOrder:z.number(),version:z.number()})),
  zones:z.array(z.object({id:Uuid,name:z.string(),active:z.boolean(),displayOrder:z.number(),version:z.number()})),
  tables:z.array(z.object({id:Uuid,zoneId:Uuid.nullable(),name:z.string(),capacity:z.number().nullable(),active:z.boolean(),displayOrder:z.number(),version:z.number()})),
});
export type RestaurantAdministrationState=z.infer<typeof RestaurantAdministrationStateSchema>;
export const PublicBusinessProfileSchema=RestaurantAdministrationStateSchema.shape.businessProfile.pick({commercialName:true,address:true,operatingHours:true,logo:true,confirmed:true});
