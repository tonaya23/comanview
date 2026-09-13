import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { EntityId } from '@comanview/domain';
import { RestaurantAdministrationCommandSchema,RestaurantAdministrationResultSchema,RestaurantAdministrationStateSchema,
  type RestaurantAdministrationCommand,type RestaurantAdministrationResult,type RestaurantAdministrationState } from '@comanview/contracts';
import * as schema from '../schema.js';
import { insertAuditEntry,type NewAuditEntry } from './AuditRepository.js';

type DB=BetterSQLite3Database<typeof schema>;
type Binding={tenantId:string;locationId:string;edgeId:string};
type Row=Record<string,unknown>;
const parse=<T>(value:unknown,fallback:T):T=>{try{return value?JSON.parse(String(value)) as T:fallback;}catch{return fallback;}};

/** Initializes only facts that can be derived from the legacy database. It does not
 * invent timezone, business identity, currency or a default when evidence conflicts. */
export function initializeLegacyAdministrationBaseline(db:Database.Database,binding:Binding,now=Date.now()):void{
  const currencies=(db.prepare(`SELECT currency FROM (SELECT base_price_currency currency FROM products UNION SELECT currency FROM cash_registers
    UNION SELECT currency FROM payments UNION SELECT currency FROM cash_movements) WHERE currency IS NOT NULL GROUP BY currency`).all() as Array<{currency:string}>).map(r=>r.currency);
  const currency=currencies.length===1?currencies[0]!:null;
  const hasMoney=Boolean(db.prepare(`SELECT 1 FROM orders LIMIT 1`).get()||db.prepare(`SELECT 1 FROM payments LIMIT 1`).get()||
    db.prepare(`SELECT 1 FROM cash_movements LIMIT 1`).get()||db.prepare(`SELECT 1 FROM cash_reports LIMIT 1`).get());
  const registers=db.prepare(`SELECT id FROM cash_registers WHERE tenant_id=? AND location_id=? AND active=1 ORDER BY id`).all(binding.tenantId,binding.locationId) as Array<{id:string}>;
  const defaultTax=db.prepare(`SELECT id FROM tax_profiles WHERE active=1 AND is_default=1 ORDER BY id LIMIT 2`).all() as Array<{id:string}>;
  db.prepare(`INSERT OR IGNORE INTO business_profiles(location_id,tenant_id,address_json,operating_hours_json,confirmed,version,updated_at)
    VALUES(?,?,'{}','[]',0,1,?)`).run(binding.locationId,binding.tenantId,now);
  db.prepare(`INSERT OR IGNORE INTO operational_configuration(location_id,tenant_id,currency,currency_locked,default_cash_register_id,
    default_tax_profile_id,fiscal_policy_version,version,updated_at) VALUES(?,?,?,?,?,?,0,1,?)`)
    .run(binding.locationId,binding.tenantId,currency,hasMoney?1:0,registers.length===1?registers[0]!.id:null,defaultTax.length===1?defaultTax[0]!.id:null,now);
  const legacy=db.prepare(`SELECT DISTINCT zone FROM restaurant_tables WHERE location_id=? AND zone IS NOT NULL AND trim(zone)<>'' ORDER BY zone`).all(binding.locationId) as Array<{zone:string}>;
  for(const item of legacy){let zone=db.prepare('SELECT id FROM zones WHERE location_id=? AND name=?').get(binding.locationId,item.zone) as {id:string}|undefined;
    if(!zone){zone={id:EntityId.generate().toString()};db.prepare(`INSERT INTO zones(id,tenant_id,location_id,name,display_order,active,version) VALUES(?,?,?,?,0,1,1)`)
      .run(zone.id,binding.tenantId,binding.locationId,item.zone);}
    db.prepare('UPDATE restaurant_tables SET zone_id=? WHERE location_id=? AND zone=? AND zone_id IS NULL').run(zone.id,binding.locationId,item.zone);
  }
}

export class RestaurantAdministrationRepository{
  constructor(private db:DB){}
  state(binding:Binding):RestaurantAdministrationState{
    const p=this.db.get<Row>(sql`SELECT commercial_name commercialName,legal_name legalName,phone,email,address_json addressJson,
      operating_hours_json hoursJson,logo_bytes logoBytes,logo_mime logoMime,logo_width logoWidth,logo_height logoHeight,confirmed,version
      FROM business_profiles WHERE location_id=${binding.locationId} AND tenant_id=${binding.tenantId}`);
    const o=this.db.get<Row>(sql`SELECT operational_timezone timeZone,business_day_rollover rollover,business_day_version businessDayVersion,
      currency,currency_locked currencyLocked,default_cash_register_id defaultCashRegisterId,default_tax_profile_id defaultTaxProfileId,
      fiscal_policy_version fiscalPolicyVersion,tip_preferences_json tipJson,version FROM operational_configuration
      WHERE location_id=${binding.locationId} AND tenant_id=${binding.tenantId}`);
    if(!p||!o)throw new Error('ADMINISTRATION_CONFIGURATION_REQUIRED');
    const logo=p['logoBytes']?{base64:Buffer.from(p['logoBytes'] as Uint8Array).toString('base64'),mime:p['logoMime'],width:p['logoWidth'],height:p['logoHeight']}:null;
    return RestaurantAdministrationStateSchema.parse({businessProfile:{commercialName:p['commercialName'],legalName:p['legalName'],phone:p['phone'],email:p['email'],
      address:parse(p['addressJson'],{}),operatingHours:parse(p['hoursJson'],[]),logo,confirmed:Boolean(p['confirmed']),version:p['version']},
      operational:{timeZone:o['timeZone'],rollover:o['rollover'],businessDayVersion:o['businessDayVersion'],currency:o['currency'],currencyLocked:Boolean(o['currencyLocked']),
        defaultCashRegisterId:o['defaultCashRegisterId'],defaultTaxProfileId:o['defaultTaxProfileId'],fiscalPolicyVersion:o['fiscalPolicyVersion'],
        tipPreferences:parse(o['tipJson'],null),version:o['version']},
      cashRegisters:this.db.all<Row>(sql`SELECT id,name,currency,active,blind_cash_count blindCashCount,display_order displayOrder,version FROM cash_registers
        WHERE tenant_id=${binding.tenantId} AND location_id=${binding.locationId} ORDER BY display_order,id`).map(r=>({...r,active:Boolean(r['active']),blindCashCount:Boolean(r['blindCashCount'])})),
      stations:this.db.all<Row>(sql`SELECT id,name,purpose,kds_visible kdsVisible,active,display_order displayOrder,version FROM stations
        WHERE tenant_id=${binding.tenantId} AND location_id=${binding.locationId} ORDER BY display_order,id`).map(r=>({...r,active:Boolean(r['active']),kdsVisible:Boolean(r['kdsVisible'])})),
      zones:this.db.all<Row>(sql`SELECT id,name,active,display_order displayOrder,version FROM zones WHERE tenant_id=${binding.tenantId}
        AND location_id=${binding.locationId} ORDER BY display_order,id`).map(r=>({...r,active:Boolean(r['active'])})),
      tables:this.db.all<Row>(sql`SELECT id,zone_id zoneId,name,capacity,active,display_order displayOrder,version FROM restaurant_tables
        WHERE tenant_id=${binding.tenantId} AND location_id=${binding.locationId} ORDER BY display_order,id`).map(r=>({...r,active:Boolean(r['active'])}))});
  }
  execute(input:RestaurantAdministrationCommand,binding:Binding,audit:NewAuditEntry):RestaurantAdministrationResult{
    const command=RestaurantAdministrationCommandSchema.parse(input),digest=createHash('sha256').update(JSON.stringify({binding,command})).digest('hex');
    return this.db.transaction(tx=>{const db=tx as unknown as DB;
      const installation=db.get<{epoch:number}>(sql`SELECT recovery_epoch epoch FROM edge_installations WHERE singleton_key='PRIMARY' AND edge_id=${binding.edgeId}
        AND tenant_id=${binding.tenantId} AND location_id=${binding.locationId}`);if(!installation)throw new Error('ADMINISTRATION_BINDING_MISMATCH');
      if(audit.action!=='RESTAURANT_ADMINISTRATION_CHANGED'||audit.commandId!==command.commandId||!audit.actorUserId||!audit.sessionId||!audit.deviceId)
        throw new Error('ADMINISTRATION_AUDIT_REQUIRED');
      const receipt=db.get<{digest:string;result:string;epoch:number}>(sql`SELECT request_digest digest,response_json result,recovery_epoch epoch
        FROM administration_command_receipts WHERE command_id=${command.commandId}`);
      if(receipt){if(receipt.digest!==digest||receipt.epoch!==installation.epoch)throw new Error('COMMAND_ID_CONFLICT');return RestaurantAdministrationResultSchema.parse(JSON.parse(receipt.result));}
      if(db.get(sql`SELECT command_id FROM processed_commands WHERE command_id=${command.commandId}`))throw new Error('COMMAND_ID_CONFLICT');
      const now=audit.occurredAt.getTime(),config=db.get<Row>(sql`SELECT * FROM operational_configuration WHERE location_id=${binding.locationId}`);
      if(!config)throw new Error('ADMINISTRATION_CONFIGURATION_REQUIRED');
      let result:RestaurantAdministrationResult,before:Row|null=null,after:Row,entityType:NewAuditEntry['entityType']='OPERATIONAL_CONFIGURATION';
      const next=(id:string,version:number)=>({entityId:id,version:version+1});
      if(command.kind==='UPDATE_BUSINESS_PROFILE'){
        const row=db.get<Row>(sql`SELECT * FROM business_profiles WHERE location_id=${binding.locationId}`);if(!row)throw new Error('ADMINISTRATION_CONFIGURATION_REQUIRED');
        if(row['version']!==command.expectedVersion)throw new Error('ADMINISTRATION_VERSION_CONFLICT');const bytes=command.logo?decodeLogo(command.logo):null;
        result=next(binding.locationId,Number(row['version']));before=row;after={...command,logo:command.logo?{mime:command.logo.mime,width:command.logo.width,height:command.logo.height}:null};entityType='BUSINESS_PROFILE';
        db.run(sql`UPDATE business_profiles SET commercial_name=${command.commercialName},legal_name=${command.legalName},phone=${command.phone},email=${command.email},
          address_json=${JSON.stringify(command.address)},operating_hours_json=${JSON.stringify(command.operatingHours)},logo_bytes=${bytes},logo_mime=${command.logo?.mime??null},
          logo_width=${command.logo?.width??null},logo_height=${command.logo?.height??null},confirmed=1,version=${result.version},updated_at=${now} WHERE location_id=${binding.locationId}`);
      }else if(command.kind==='SET_BUSINESS_DAY_POLICY'){
        if(config['version']!==command.expectedVersion)throw new Error('ADMINISTRATION_VERSION_CONFLICT');assertTimeZone(command.timeZone);assertNoOpenWork(db,binding.locationId,'BUSINESS_DAY_POLICY_IN_USE');
        result=next(binding.locationId,Number(config['version']));before=config;after={timeZone:command.timeZone,rollover:command.rollover,businessDayVersion:Number(config['business_day_version'])+1};
        db.run(sql`UPDATE operational_configuration SET operational_timezone=${command.timeZone},business_day_rollover=${command.rollover},business_day_version=business_day_version+1,
          version=${result.version},updated_at=${now} WHERE location_id=${binding.locationId}`);
      }else if(command.kind==='SET_CURRENCY'){
        if(config['version']!==command.expectedVersion)throw new Error('ADMINISTRATION_VERSION_CONFLICT');
        if(hasFinancialActivity(db))throw new Error('CURRENCY_LOCKED');assertPreparedCurrency(db,command.currency);
        result=next(binding.locationId,Number(config['version']));before=config;after={currency:command.currency};
        db.run(sql`UPDATE operational_configuration SET currency=${command.currency},version=${result.version},updated_at=${now} WHERE location_id=${binding.locationId}`);
      }else if(command.kind==='CREATE_CASH_REGISTER'){
        if(command.expectedVersion!==0)throw new Error('ADMINISTRATION_VERSION_CONFLICT');const currency=String(config['currency']??'');if(!currency)throw new Error('CURRENCY_REQUIRED');
        if(command.makeDefault&&hasOpenCash(db))throw new Error('CASH_REGISTER_IN_USE');const id=EntityId.generate().toString();
        db.run(sql`INSERT INTO cash_registers(id,tenant_id,location_id,name,currency,active,blind_cash_count,created_at,version,display_order)
          VALUES(${id},${binding.tenantId},${binding.locationId},${command.name},${currency},1,${command.blindCashCount?1:0},${now},1,${command.displayOrder})`);
        if(command.makeDefault)db.run(sql`UPDATE operational_configuration SET default_cash_register_id=${id},version=version+1,updated_at=${now} WHERE location_id=${binding.locationId}`);
        result={entityId:id,version:1};after={...command,id,currency};entityType='CASH_REGISTER';
      }else if(command.kind==='UPDATE_CASH_REGISTER'){
        const row=db.get<Row>(sql`SELECT * FROM cash_registers WHERE id=${command.cashRegisterId} AND location_id=${binding.locationId}`);if(!row)throw new Error('CASH_REGISTER_REQUIRED');
        if(row['version']!==command.expectedVersion)throw new Error('ADMINISTRATION_VERSION_CONFLICT');const isDefault=config['default_cash_register_id']===command.cashRegisterId;
        if((!command.active||command.makeDefault&&!isDefault)&&hasOpenCash(db))throw new Error('CASH_REGISTER_IN_USE');if(!command.active&&isDefault)throw new Error('DEFAULT_CASH_REGISTER_REQUIRED');
        result=next(command.cashRegisterId,Number(row['version']));before=row;after={...command};entityType='CASH_REGISTER';
        db.run(sql`UPDATE cash_registers SET name=${command.name},active=${command.active?1:0},blind_cash_count=${command.blindCashCount?1:0},display_order=${command.displayOrder},version=${result.version} WHERE id=${command.cashRegisterId}`);
        if(command.makeDefault)db.run(sql`UPDATE operational_configuration SET default_cash_register_id=${command.cashRegisterId},version=version+1,updated_at=${now} WHERE location_id=${binding.locationId}`);
      }else if(command.kind==='CREATE_STATION'){
        if(command.expectedVersion!==0)throw new Error('ADMINISTRATION_VERSION_CONFLICT');const id=EntityId.generate().toString();
        db.run(sql`INSERT INTO stations(id,tenant_id,location_id,name,active,version,display_order,purpose,kds_visible) VALUES(${id},${binding.tenantId},${binding.locationId},
          ${command.name},1,1,${command.displayOrder},${command.purpose},${command.kdsVisible?1:0})`);result={entityId:id,version:1};after={...command,id};entityType='STATION';
      }else if(command.kind==='UPDATE_STATION'){
        const row=db.get<Row>(sql`SELECT * FROM stations WHERE id=${command.stationId} AND location_id=${binding.locationId}`);if(!row)throw new Error('STATION_REQUIRED');
        if(row['version']!==command.expectedVersion)throw new Error('ADMINISTRATION_VERSION_CONFLICT');if(!command.active&&stationHasPendingWork(db,command.stationId))throw new Error('STATION_HAS_PENDING_WORK');
        result=next(command.stationId,Number(row['version']));before=row;after={...command};entityType='STATION';
        db.run(sql`UPDATE stations SET name=${command.name},purpose=${command.purpose},kds_visible=${command.kdsVisible?1:0},active=${command.active?1:0},display_order=${command.displayOrder},version=${result.version} WHERE id=${command.stationId}`);
      }else if(command.kind==='ASSIGN_PRODUCT_STATION'){
        const row=db.get<Row>(sql`SELECT id,station_id stationId,version FROM products WHERE id=${command.productId}`);if(!row)throw new Error('PRODUCT_NOT_FOUND');
        if(row['version']!==command.expectedVersion)throw new Error('ADMINISTRATION_VERSION_CONFLICT');if(stationHasPendingWork(db,String(row['stationId']??''),command.productId))throw new Error('STATION_HAS_PENDING_WORK');
        if(command.stationId&&!db.get(sql`SELECT id FROM stations WHERE id=${command.stationId} AND location_id=${binding.locationId} AND active=1`))throw new Error('STATION_REQUIRED');
        result=next(command.productId,Number(row['version']));before=row;after={stationId:command.stationId};entityType='PRODUCT';
        db.run(sql`UPDATE products SET station_id=${command.stationId},version=${result.version} WHERE id=${command.productId}`);
      }else if(command.kind==='CREATE_ZONE'){
        if(command.expectedVersion!==0)throw new Error('ADMINISTRATION_VERSION_CONFLICT');const id=EntityId.generate().toString();
        db.run(sql`INSERT INTO zones(id,tenant_id,location_id,name,display_order,active,version) VALUES(${id},${binding.tenantId},${binding.locationId},${command.name},${command.displayOrder},1,1)`);
        result={entityId:id,version:1};after={...command,id};entityType='ZONE';
      }else if(command.kind==='UPDATE_ZONE'){
        const row=db.get<Row>(sql`SELECT * FROM zones WHERE id=${command.zoneId} AND location_id=${binding.locationId}`);if(!row)throw new Error('ZONE_REQUIRED');
        if(row['version']!==command.expectedVersion)throw new Error('ADMINISTRATION_VERSION_CONFLICT');if(!command.active&&db.get(sql`SELECT id FROM restaurant_tables WHERE zone_id=${command.zoneId} AND active=1 LIMIT 1`))throw new Error('ZONE_IN_USE');
        result=next(command.zoneId,Number(row['version']));before=row;after={...command};entityType='ZONE';
        db.run(sql`UPDATE zones SET name=${command.name},active=${command.active?1:0},display_order=${command.displayOrder},version=${result.version} WHERE id=${command.zoneId}`);
        db.run(sql`UPDATE restaurant_tables SET zone=${command.name} WHERE zone_id=${command.zoneId}`);
      }else if(command.kind==='CREATE_TABLE'){
        if(command.expectedVersion!==0)throw new Error('ADMINISTRATION_VERSION_CONFLICT');const zone=activeZone(db,command.zoneId,binding.locationId),id=EntityId.generate().toString();
        db.run(sql`INSERT INTO restaurant_tables(id,tenant_id,location_id,name,zone,capacity,display_order,active,zone_id,version) VALUES(${id},${binding.tenantId},${binding.locationId},
          ${command.name},${zone.name},${command.capacity},${command.displayOrder},1,${zone.id},1)`);result={entityId:id,version:1};after={...command,id};entityType='RESTAURANT_TABLE';
      }else if(command.kind==='UPDATE_TABLE'){
        const row=db.get<Row>(sql`SELECT * FROM restaurant_tables WHERE id=${command.tableId} AND location_id=${binding.locationId}`);if(!row)throw new Error('TABLE_NOT_FOUND');
        if(row['version']!==command.expectedVersion)throw new Error('ADMINISTRATION_VERSION_CONFLICT');if(db.get(sql`SELECT order_id FROM order_table_assignments WHERE table_id=${command.tableId} AND released_at IS NULL`))throw new Error('TABLE_HAS_ACTIVE_ORDER');
        const zone=activeZone(db,command.zoneId,binding.locationId);result=next(command.tableId,Number(row['version']));before=row;after={...command};entityType='RESTAURANT_TABLE';
        db.run(sql`UPDATE restaurant_tables SET zone_id=${zone.id},zone=${zone.name},name=${command.name},capacity=${command.capacity},active=${command.active?1:0},display_order=${command.displayOrder},version=${result.version} WHERE id=${command.tableId}`);
      }else{
        if(config['version']!==command.expectedVersion)throw new Error('ADMINISTRATION_VERSION_CONFLICT');result=next(binding.locationId,Number(config['version']));before=config;after={preferences:command.preferences};
        db.run(sql`UPDATE operational_configuration SET tip_preferences_json=${JSON.stringify(command.preferences)},version=${result.version},updated_at=${now} WHERE location_id=${binding.locationId}`);
      }
      const eventId=EntityId.generate().toString();db.insert(schema.eventLog).values({id:eventId,eventType:'RESTAURANT_ADMINISTRATION_CHANGED',aggregateType:entityType,
        aggregateId:result.entityId,version:result.version,recoveryEpoch:installation.epoch,payload:JSON.stringify({kind:command.kind,tenantId:binding.tenantId,locationId:binding.locationId,after}),
        occurredAt:audit.occurredAt,commandId:command.commandId,syncStatus:'PENDING'}).run();
      insertAuditEntry(db,{...audit,entityType,entityId:result.entityId,reason:command.reason,before,after,eventId,outcome:'SUCCESS'});
      db.run(sql`INSERT INTO administration_command_receipts(command_id,location_id,command_type,request_digest,response_json,recovery_epoch,completed_at)
        VALUES(${command.commandId},${binding.locationId},${command.kind},${digest},${JSON.stringify(result)},${installation.epoch},${now})`);
      db.insert(schema.processedCommands).values({commandId:command.commandId,processedAt:audit.occurredAt}).run();return result;
    },{behavior:'immediate'});
  }
}

function assertTimeZone(zone:string){try{new Intl.DateTimeFormat('en',{timeZone:zone}).format();}catch{throw new Error('BUSINESS_TIME_ZONE_INVALID');}}
function hasOpenCash(db:DB){return Boolean(db.get(sql`SELECT id FROM cash_sessions WHERE status='OPEN' LIMIT 1`));}
function assertNoOpenWork(db:DB,location:string,code:string){if(hasOpenCash(db)||db.get(sql`SELECT id FROM orders WHERE location_id=${location} AND status='OPEN' LIMIT 1`))throw new Error(code);}
function hasFinancialActivity(db:DB){return Boolean(db.get(sql`SELECT id FROM orders LIMIT 1`)||db.get(sql`SELECT id FROM payments LIMIT 1`)||db.get(sql`SELECT id FROM cash_movements LIMIT 1`)||db.get(sql`SELECT id FROM cash_reports LIMIT 1`));}
function assertPreparedCurrency(db:DB,currency:string){const rows=db.all<{currency:string}>(sql`SELECT base_price_currency currency FROM products UNION SELECT price_delta_currency FROM modifier_options
  UNION SELECT price_delta_currency FROM modifier_price_overrides`);if(rows.some(r=>r.currency!==currency))throw new Error('CURRENCY_PRICE_REENTRY_REQUIRED');}
function stationHasPendingWork(db:DB,stationId:string,productId?:string){if(!stationId)return false;return Boolean(db.get(sql`SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id
  WHERE oi.station_id=${stationId} AND (${productId??null} IS NULL OR oi.product_id=${productId??null}) AND o.status='OPEN' AND oi.send_status='SENT' AND oi.prep_status IN ('PENDING','PREPARING') LIMIT 1`));}
function activeZone(db:DB,id:string,location:string){const row=db.get<{id:string;name:string}>(sql`SELECT id,name FROM zones WHERE id=${id} AND location_id=${location} AND active=1`);if(!row)throw new Error('ZONE_REQUIRED');return row;}
function decodeLogo(logo:{base64:string;mime:'image/png'|'image/jpeg';width:number;height:number}){const bytes=Buffer.from(logo.base64,'base64');if(bytes.length>1048576||bytes.toString('base64').replace(/=+$/,'')!==logo.base64.replace(/=+$/,''))throw new Error('BUSINESS_LOGO_INVALID');
  const size=imageSize(bytes,logo.mime);if(!size||size.width!==logo.width||size.height!==logo.height)throw new Error('BUSINESS_LOGO_INVALID');return bytes;}
function imageSize(b:Buffer,mime:string):{width:number;height:number}|null{if(mime==='image/png'&&b.length>=24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return{width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
  if(mime==='image/jpeg'&&b[0]===0xff&&b[1]===0xd8){let i=2;while(i+9<b.length){if(b[i]!==0xff){i++;continue;}const marker=b[i+1]!,len=b.readUInt16BE(i+2);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return{height:b.readUInt16BE(i+5),width:b.readUInt16BE(i+7)};if(len<2)break;i+=2+len;}}return null;}
