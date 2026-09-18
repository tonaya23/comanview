import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { EntityId, TaxProfile } from '@comanview/domain';
import { TaxAdministrationCommandSchema, TaxAdministrationResultSchema,TaxAdministrationStateSchema,
  type TaxAdministrationCommand, type TaxAdministrationResult,type TaxAdministrationState } from '@comanview/contracts';
import * as schema from '../schema.js';
import { insertAuditEntry, type NewAuditEntry } from './AuditRepository.js';
import { assignProductReference } from './ProductAssignmentTransaction.js';

type DB = BetterSQLite3Database<typeof schema>;
type Binding = { tenantId: string; locationId: string; edgeId: string };
type Profile = { id: string; name: string; rate: number; mode: 'TAX_ADDED' | 'TAX_INCLUDED'; active: number; version: number };

/** Persistence boundary only. The application must authorize the current actor before
 * calling. Revisions, OCC, command receipt, Audit and Outbox commit atomically here.
 */
export class TaxAdministrationRepository {
  constructor(private readonly db: DB) {}

  state(binding:{tenantId:string;locationId:string}):TaxAdministrationState{
    const config=this.db.get<{policy:number;profileId:string|null;version:number}>(sql`SELECT fiscal_policy_version policy,default_tax_profile_id profileId,version
      FROM operational_configuration WHERE tenant_id=${binding.tenantId} AND location_id=${binding.locationId}`);if(!config)throw new Error('ADMINISTRATION_CONFIGURATION_REQUIRED');
    return TaxAdministrationStateSchema.parse({fiscalPolicyVersion:config.policy,defaultTaxProfileId:config.profileId,configurationVersion:config.version,
      profiles:this.db.all<{id:string;name:string;rateBasisPoints:number;calculationMode:string;active:number;version:number}>(sql`SELECT id,name,rate_basis_points rateBasisPoints,calculation_mode calculationMode,active,version FROM tax_profiles ORDER BY name,id`)
        .map(x=>({...x,active:Boolean(x.active)})),
      products:this.db.all(sql`SELECT id,name,tax_profile_id taxProfileId,tax_profile_revision taxProfileRevision,version FROM products ORDER BY name,id`)});
  }

  execute(input: TaxAdministrationCommand, binding: Binding, audit: NewAuditEntry, authorize:(epoch:number)=>void=()=>{},onCommitted?:(result:TaxAdministrationResult)=>void): TaxAdministrationResult {
    const command = TaxAdministrationCommandSchema.parse(input);
    const digest = createHash('sha256').update(JSON.stringify({ binding, command, ...(command.kind==='ASSIGN_PRODUCT_TAX_PROFILE'?{actor:audit.actorUserId,device:audit.deviceId,session:audit.sessionId}:{}) })).digest('hex');
    let assignment=false;
    const result=this.db.transaction(tx => {
      const db = tx as unknown as DB;
      const installation = db.get<{ epoch: number }>(sql`SELECT recovery_epoch AS epoch FROM edge_installations
        WHERE singleton_key='PRIMARY' AND edge_id=${binding.edgeId} AND tenant_id=${binding.tenantId} AND location_id=${binding.locationId}`);
      if (!installation) throw new Error('ADMINISTRATION_BINDING_MISMATCH');
      authorize(installation.epoch);
      if (audit.tenantId !== binding.tenantId || audit.locationId !== binding.locationId || !audit.actorUserId ||
        !audit.sessionId || !audit.deviceId || audit.action !== 'TAX_CONFIGURATION_CHANGED' || audit.commandId !== command.commandId)
        throw new Error('ADMINISTRATION_AUDIT_REQUIRED');
      const receipt = db.get<{ digest: string; result: string; epoch: number }>(sql`SELECT request_digest AS digest,
        response_json AS result,recovery_epoch AS epoch FROM administration_command_receipts WHERE command_id=${command.commandId}`);
      if (receipt) {
        if (receipt.digest !== digest || receipt.epoch !== installation.epoch) throw new Error('COMMAND_ID_CONFLICT');
        return TaxAdministrationResultSchema.parse(JSON.parse(receipt.result));
      }
      if (db.get(sql`SELECT command_id FROM processed_commands WHERE command_id=${command.commandId}`))
        throw new Error('COMMAND_ID_CONFLICT');
      if(command.kind==='ASSIGN_PRODUCT_TAX_PROFILE'){assignment=true;return assignProductReference(db,command,binding,installation.epoch,audit,digest,(this.db as DB & {$client:Database.Database}).$client);}
      let result: TaxAdministrationResult;
      let before: Record<string, unknown> | null = null;
      let after: Record<string, unknown>;
      let entityType: NewAuditEntry['entityType'] = 'TAX_PROFILE';
      const now = audit.occurredAt.getTime();
      if (command.kind === 'CREATE_TAX_PROFILE') {
        if (command.expectedVersion !== 0) throw new Error('ADMINISTRATION_VERSION_CONFLICT');
        const id = EntityId.generate().toString();
        new TaxProfile({ id: EntityId.fromString(id), name: command.name, rateBasisPoints: command.rateBasisPoints,
          calculationMode: command.calculationMode, active: true, revision: 1 });
        db.run(sql`INSERT INTO tax_profiles(id,name,rate_basis_points,calculation_mode,active,is_default,version)
          VALUES(${id},${command.name},${command.rateBasisPoints},${command.calculationMode},1,0,1)`);
        db.run(sql`INSERT INTO tax_profile_revisions(tax_profile_id,revision,rate_basis_points,calculation_mode,created_at)
          VALUES(${id},1,${command.rateBasisPoints},${command.calculationMode},${now})`);
        result = { entityId: id, version: 1 };
        after = { id, name: command.name, rateBasisPoints: command.rateBasisPoints, calculationMode: command.calculationMode, active: true, version: 1 };
      } else {
        const profile = db.get<Profile>(sql`SELECT id,name,rate_basis_points AS rate,calculation_mode AS mode,active,version
          FROM tax_profiles WHERE id=${command.profileId}`);
        if (!profile) throw new Error('TAX_PROFILE_REQUIRED');
        const immutable = db.get<{ rate: number; mode: string }>(sql`SELECT rate_basis_points AS rate,calculation_mode AS mode
          FROM tax_profile_revisions WHERE tax_profile_id=${profile.id} AND revision=${profile.version}`);
        if (!immutable || immutable.rate !== profile.rate || immutable.mode !== profile.mode) throw new Error('TAX_REVISION_INCONSISTENT');
        if (command.kind === 'REVISE_TAX_PROFILE' || command.kind === 'DEACTIVATE_TAX_PROFILE') {
          if (command.expectedVersion !== profile.version) throw new Error('ADMINISTRATION_VERSION_CONFLICT');
          if (command.kind === 'DEACTIVATE_TAX_PROFILE' && (
            db.get(sql`SELECT id FROM products WHERE tax_profile_id=${profile.id} AND active=1 LIMIT 1`) ||
            db.get(sql`SELECT location_id FROM operational_configuration WHERE default_tax_profile_id=${profile.id}`)))
            throw new Error('TAX_PROFILE_IN_USE');
          const version = profile.version + 1;
          if (!Number.isSafeInteger(version)) throw new Error('TAX_REVISION_INVALID');
          const name = command.kind === 'REVISE_TAX_PROFILE' ? command.name : profile.name;
          const rate = command.kind === 'REVISE_TAX_PROFILE' ? command.rateBasisPoints : profile.rate;
          const mode = command.kind === 'REVISE_TAX_PROFILE' ? command.calculationMode : profile.mode;
          const active = command.kind === 'DEACTIVATE_TAX_PROFILE' ? 0 : profile.active;
          db.run(sql`INSERT INTO tax_profile_revisions(tax_profile_id,revision,rate_basis_points,calculation_mode,created_at)
            VALUES(${profile.id},${version},${rate},${mode},${now})`);
          db.run(sql`UPDATE tax_profiles SET name=${name},rate_basis_points=${rate},calculation_mode=${mode},active=${active},version=${version}
            WHERE id=${profile.id}`);
          before = { ...profile }; after = { id: profile.id, name, rateBasisPoints: rate, calculationMode: mode, active: Boolean(active), version };
          result = { entityId: profile.id, version };
        } else {
          if (!profile.active) throw new Error('TAX_PROFILE_INACTIVE');
          const config = db.get<{ version: number; profileId: string | null }>(sql`SELECT version,default_tax_profile_id AS profileId
            FROM operational_configuration WHERE location_id=${binding.locationId} AND tenant_id=${binding.tenantId}`);
          if (!config) throw new Error('ADMINISTRATION_CONFIGURATION_REQUIRED');
          if (config.version !== command.expectedVersion) throw new Error('ADMINISTRATION_VERSION_CONFLICT');
          result = { entityId: binding.locationId, version: config.version + 1 };
          db.run(sql`UPDATE operational_configuration SET default_tax_profile_id=${profile.id},fiscal_policy_version=1,
            version=${result.version},updated_at=${now} WHERE location_id=${binding.locationId}`);
          db.run(sql`UPDATE tax_profiles SET is_default=CASE WHEN id=${profile.id} THEN 1 ELSE 0 END`);
          before = { ...config }; after = { ...result, profileId: profile.id, fiscalPolicyVersion: 1 }; entityType = 'OPERATIONAL_CONFIGURATION';
        }
      }
      const eventId = EntityId.generate().toString();
      db.insert(schema.eventLog).values({ id: eventId, eventType: 'TAX_CONFIGURATION_CHANGED', aggregateType: entityType,
        aggregateId: result.entityId, version: result.version, recoveryEpoch: installation.epoch,
        payload: JSON.stringify({ kind: command.kind, tenantId: binding.tenantId, locationId: binding.locationId, after }),
        occurredAt: audit.occurredAt, commandId: command.commandId, syncStatus: 'PENDING' }).run();
      insertAuditEntry(db, { ...audit, entityType, entityId: result.entityId, reason: command.reason, before, after, eventId, outcome: 'SUCCESS' });
      db.run(sql`INSERT INTO administration_command_receipts(command_id,location_id,command_type,request_digest,response_json,recovery_epoch,completed_at)
        VALUES(${command.commandId},${binding.locationId},${command.kind},${digest},${JSON.stringify(result)},${installation.epoch},${now})`);
      db.insert(schema.processedCommands).values({ commandId: command.commandId, processedAt: audit.occurredAt }).run();
      return result;
    }, { behavior: 'immediate' });
    if(assignment&&result.changed){try{onCommitted?.(result);}catch{/* Best-effort invalidation; durable commit remains successful. */}}
    return result;
  }
}
