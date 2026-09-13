import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EntityId, Order, ProductSnapshot } from '@comanview/domain';
import { Money } from '@comanview/money';
import { signControlDocument, verifyControlDocument, assertDocumentBinding } from '@comanview/licensing';
import type { ConfigurationDocumentPayload, FeatureFlagsDocumentPayload } from '@comanview/contracts';
import { AuditRepository, CashRepository, OrderRepository, EdgeControlRepository,
  RestaurantAdministrationRepository, initializeLegacyAdministrationBaseline } from '@comanview/database';
import * as schema from '@comanview/database/edge';
import { AdministrationService } from './AdministrationService.js';
import { EdgeLicenseManager } from '../licensing/EdgeLicenseManager.js';
import { PaymentService } from '../payments/application/PaymentService.js';
import { RealtimeHub } from '../../infrastructure/realtime/RealtimeHub.js';
import { defaultOperationalContext } from '../../app/operationalContext.js';
import type { AuthenticatedActor } from '../../app/authContext.js';
import { MemoryRecoverySecurityStore, initializeRecoverySecurityFloor, updateRecoverySecurityFloor } from '../backup/RecoverySecurityStore.js';
import { createEncryptedBackupArtifact } from '../backup/BackupArtifact.js';
import { scheduleEmergencyRecovery, completePendingRecoveryAtStartup } from '../backup/RecoveryCoordinator.js';

const id=()=>EntityId.generate().toString();
const migrations=fileURLToPath(new URL('../../../../../migrations/edge/',import.meta.url));

describe('current Cloud tip policy bounds persisted Owner intent',()=>{
  it('enforces signed reductions in payments, offline, restart and restored SQLite preferences',async()=>{
    const root=await mkdtemp(join(tmpdir(),'cv-tip-policy-'));
    let sqlite=new Database(join(root,'edge.db'));
    try{
      for(const name of readdirSync(migrations).filter(n=>/^\d{4}_.*\.sql$/.test(n)).sort())sqlite.exec(readFileSync(join(migrations,name),'utf8'));
      const binding={tenantId:id(),locationId:id(),edgeId:id()},keys=generateKeyPairSync('ed25519');
      const keyring={test:keys.publicKey.export({type:'spki',format:'pem'}).toString()};
      sqlite.prepare("INSERT INTO edge_installations(singleton_key,edge_id,tenant_id,location_id,created_at) VALUES('PRIMARY',?,?,?,1)").run(binding.edgeId,binding.tenantId,binding.locationId);
      initializeLegacyAdministrationBaseline(sqlite,binding);
      const store=new MemoryRecoverySecurityStore();
      await initializeRecoverySecurityFloor({store,sqlite,binding});
      const actor:AuthenticatedActor={...binding,userId:id(),deviceId:id(),sessionId:id(),displayName:'Owner',roles:['OWNER'],permissions:['TIP_PREFERENCES_MANAGE']};
      const services=()=>{
        const db=drizzle(sqlite,{schema}),control=new EdgeControlRepository(db);
        const licensing=new EdgeLicenseManager(control,null,{enforcementEnabled:false,publicKeyring:keyring,pullIntervalMs:1000,maxBackoffMs:1000,checkpointIntervalMs:1000},binding,undefined,store,sqlite);
        return {db,control,licensing,admin:new AdministrationService(new RestaurantAdministrationRepository(db),binding,licensing)};
      };
      let s=services();
      const apply=async(revision:number,allowed:number[],overrides:Partial<NonNullable<ConfigurationDocumentPayload['configuration']['tipPolicy']>>={})=>{
        const payload:ConfigurationDocumentPayload={...binding,formatVersion:1,documentId:id(),revision,documentType:'CONFIGURATION',issuedAt:new Date().toISOString(),
          configuration:{payment:{tipsEnabled:true,tipPercentageOptionsBasisPoints:[1000,1500]},
            tipPolicy:{ownerConfigurable:true,allowPercentages:true,allowedPercentagesBasisPoints:allowed,allowFixedAmount:false,...overrides}}};
        const envelope=signControlDocument(payload,'test',keys.privateKey.export({type:'pkcs8',format:'pem'}).toString());
        const verified=verifyControlDocument(envelope,keyring);assertDocumentBinding(verified.payload,binding);
        const result=s.control.applyDocument({...verified,envelope,receivedAt:new Date()});
        await store.mutate(floor=>updateRecoverySecurityFloor(floor,{maximumSignedRevisions:{...floor.maximumSignedRevisions,CONFIGURATION:Math.max(revision,floor.maximumSignedRevisions.CONFIGURATION)}}));
        return result;
      };
      await apply(1,[1000,1500]);
      s.admin.execute({kind:'SET_TIP_PREFERENCES',commandId:id(),expectedVersion:1,reason:'Choose tips',
        preferences:{enabled:true,percentageOptionsBasisPoints:[1500],fixedAmountEnabled:false}},actor);
      expect(s.admin.effectiveTips().percentageOptionsBasisPoints).toEqual([1500]);
      await s.licensing.pullOnce(); // No transport: offline retains the last valid policy.
      expect(s.admin.effectiveTips().percentageOptionsBasisPoints).toEqual([1500]);
      const backupId=id(),recoveryKey=(await store.load()).recoveryKey!;
      const backup=await createEncryptedBackupArtifact({source:sqlite,destinationDirectory:join(root,'backups'),backupId,
        binding:{...binding,recoveryEpoch:0},recoveryKey,trigger:'MANUAL',destinationType:'LOCAL',businessDate:null});
      await apply(2,[1000]);
      expect(s.admin.effectiveTips().percentageOptionsBasisPoints).toEqual([1000]);
      const flags:FeatureFlagsDocumentPayload={...binding,formatVersion:1,documentId:id(),revision:1,
        documentType:'FEATURE_FLAGS',issuedAt:new Date().toISOString(),flags:{tipsEnabled:true,allowTip15:true}};
      const flagsEnvelope=signControlDocument(flags,'test',keys.privateKey.export({type:'pkcs8',format:'pem'}).toString());
      const verifiedFlags=verifyControlDocument(flagsEnvelope,keyring);assertDocumentBinding(verifiedFlags.payload,binding);
      s.control.applyDocument({...verifiedFlags,envelope:flagsEnvelope,receivedAt:new Date()});
      // Even with all development entitlements and enabled flags, policy wins.
      expect(s.licensing.effectiveCapabilities().capabilities).toContain('CORE_POS');
      expect(s.admin.effectiveTips().percentageOptionsBasisPoints).toEqual([1000]);
      expect(s.admin.operational().tipPreferences?.percentageOptionsBasisPoints).toEqual([1500]);
      sqlite.close();sqlite=new Database(join(root,'edge.db'));s=services();
      expect(s.admin.effectiveTips().percentageOptionsBasisPoints).toEqual([1000]);

      const register=id(),session=id();
      sqlite.prepare("INSERT INTO cash_registers(id,tenant_id,location_id,name,currency,active,created_at) VALUES(?,?,?,'Main','MXN',1,1)").run(register,binding.tenantId,binding.locationId);
      sqlite.prepare("INSERT INTO cash_sessions(id,cash_register_id,tenant_id,location_id,opening_float_amount,currency,business_date,status,opened_at,opened_by,open_command_id) VALUES(?,?,?,?,0,'MXN','2026-09-09','OPEN',1,?,?)").run(session,register,binding.tenantId,binding.locationId,actor.userId,id());
      const orders=new OrderRepository(s.db);
      const order=Order.create({tenantId:EntityId.fromString(binding.tenantId),locationId:EntityId.fromString(binding.locationId),currency:'MXN',orderType:'COUNTER',orderChannel:'POS',orderNumber:'TIP-1'});
      order.addItem(new ProductSnapshot({productId:EntityId.generate(),productName:'Item',basePrice:Money.fromMinorUnits(10000,'MXN'),taxRateBasisPoints:0,taxCalculationMode:'TAX_ADDED',stationId:null,modifiers:[]}));
      orders.saveOrder(order);
      const payments=new PaymentService(orders,new CashRepository(s.db),new AuditRepository(s.db),{...defaultOperationalContext,...binding,cashRegisterId:register},new RealtimeHub(),s.licensing,s.admin);
      const request={commandId:id(),expectedVersion:order.version,method:'CARD' as const,amountApplied:10000,tip:{type:'PERCENTAGE' as const,basisPoints:1500}};
      const operation={actor,authorizedBy:null,permission:'PAYMENT_CREATE' as const,requestedAt:new Date()};
      expect(()=>payments.createPayment(order.id.toString(),request,operation)).toThrow(expect.objectContaining({code:'TIP_SELECTION_NOT_ALLOWED'}));
      expect(orders.getOrderById(order.id)?.payments).toHaveLength(0);
      const paid=payments.createPayment(order.id.toString(),{...request,tip:{type:'PERCENTAGE',basisPoints:1000}},operation);
      expect(paid.tipTotal.amount).toBe(1000);

      // Real restore invalidates the old signed document using the external floor.
      // Until the current policy is recovered, neither local intent nor defaults
      // may grant tips. No network loss alone revokes an available current policy.
      sqlite.close();
      await scheduleEmergencyRecovery({dbPath:join(root,'edge.db'),securityStore:store,binding,publicKeyring:{},backupId,
        artifactPath:backup.artifactPath,recoveryKey,commandId:id(),now:new Date()});
      expect(await completePendingRecoveryAtStartup({dbPath:join(root,'edge.db'),store})).toBe('COMPLETED');
      sqlite=new Database(join(root,'edge.db'));s=services();
      expect(s.admin.effectiveTips()).toMatchObject({tipsEnabled:false,percentageOptionsBasisPoints:[]});
      await apply(2,[1000]);
      expect(s.admin.operational().tipPreferences?.percentageOptionsBasisPoints).toEqual([1500]);
      expect(s.admin.effectiveTips().percentageOptionsBasisPoints).toEqual([1000]);
      await apply(3,[1000],{allowPercentages:false,allowFixedAmount:false});
      expect(s.admin.effectiveTips()).toMatchObject({tipsEnabled:false,percentageOptionsBasisPoints:[],fixedAmountEnabled:false});
      await apply(4,[1000],{ownerConfigurable:false});
      expect(s.admin.effectiveTips()).toMatchObject({percentageOptionsBasisPoints:[1000],ownerConfigurable:false});
      await apply(5,[1000,1500]);
      s.admin.execute({kind:'SET_TIP_PREFERENCES',commandId:id(),expectedVersion:2,reason:'Hide percentages',
        preferences:{enabled:true,percentageOptionsBasisPoints:[],fixedAmountEnabled:false}},actor);
      expect(s.admin.effectiveTips().percentageOptionsBasisPoints).toEqual([]);
    }finally{if(sqlite.open)sqlite.close();await rm(root,{recursive:true,force:true});}
  });
});
