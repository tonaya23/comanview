import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID as id } from 'node:crypto';
import { hashOperationalPin, hashSessionToken } from '@comanview/auth';
import {
  AuthRepository,
  CatalogRepository,
  TaxAdministrationRepository,
  RestaurantAdministrationRepository,
  EdgeControlRepository,
} from '@comanview/database';
import { TaxAdministrationService } from '../../administration/TaxAdministrationService.js';
import { AdministrationService } from '../../administration/AdministrationService.js';
import { taxAdministrationRoutes } from '../../administration/taxRoutes.js';
import { administrationRoutes } from '../../administration/routes.js';
import { EdgeLicenseManager } from '../../licensing/EdgeLicenseManager.js';
import * as schema from '@comanview/database/edge';
import {
  MemoryRecoverySecurityStore,
  initializeRecoverySecurityFloor,
} from '../../backup/RecoverySecurityStore.js';
import { prepareProductionAdministrationUpgrade } from '../../personnel/ProductionAdministrationUpgrade.js';
import { prepareProductionCatalogUpgrade } from './ProductionCatalogUpgrade.js';
import { CatalogCommandService } from './CatalogCommandService.js';
import { CatalogService } from './CatalogService.js';
import { catalogRoutes } from '../http/routes.js';
import { AuthService } from '../../auth/application/AuthService.js';
import { AuthGuard } from '../../auth/http/AuthGuard.js';
import { errorHandler } from '../../../app/errorHandler.js';

it.each([16, 17, 18] as const)('HTTP schema %s uses real Auth/Personnel/Floor, rejects legacy, and rechecks revoked persisted grants on receipt retry', async (targetSchema) => {
  const root = await mkdtemp(join(tmpdir(), 'cv-catalog-http-')),
    dbPath = join(root, 'edge.db');
  let db: Database.Database | undefined;
  const app = Fastify();
  try {
    db = new Database(dbPath);
    const migrationRoot = fileURLToPath(
      new URL('../../../../../../migrations/edge/', import.meta.url),
    );
    for (const name of readdirSync(migrationRoot)
      .filter((n) => /^\d{4}_.*\.sql$/.test(n) && Number(n.slice(0, 4)) <= 14)
      .sort())
      db.exec(readFileSync(join(migrationRoot, name), 'utf8'));
    const binding = { tenantId: id(), locationId: id(), edgeId: id() },
      ownerId = id(),
      deviceId = id(),
      credentialId = id();
    db.prepare(
      "INSERT INTO edge_installations(singleton_key,edge_id,tenant_id,location_id,credential_id,created_at,provisioning_state) VALUES('PRIMARY',?,?,?,?,1,'ACTIVE')",
    ).run(binding.edgeId, binding.tenantId, binding.locationId, credentialId);
    db.prepare(
      "INSERT INTO users(id,tenant_id,location_id,display_name,status,pin_hash,created_at) VALUES(?,?,?,'Owner','ACTIVE',?,1)",
    ).run(ownerId, binding.tenantId, binding.locationId, await hashOperationalPin('9876'));
    db.prepare("INSERT INTO user_roles SELECT ?,id FROM roles WHERE name='OWNER'").run(ownerId);
    db.exec(
      "INSERT OR IGNORE INTO permissions(code,description) VALUES('CATALOG_MANAGE','Manage catalog'),('CATALOG_VIEW','View catalog'); INSERT OR IGNORE INTO role_permissions SELECT id,'CATALOG_MANAGE' FROM roles WHERE name='OWNER'; INSERT OR IGNORE INTO role_permissions SELECT id,'CATALOG_VIEW' FROM roles WHERE name='OWNER'",
    );
    const store = new MemoryRecoverySecurityStore();
    await initializeRecoverySecurityFloor({ store, sqlite: db, binding });
    db.close();
    db = undefined;
    const input = {
      dbPath,
      store,
      edgeSecretStore: {
        load: async () => ({
          active: { credentialId, credential: 'fixture-secret-only' },
          pending: null,
        }),
        save: async () => {},
        hasPersistedState: async () => true,
      },
    };
    expect(await prepareProductionAdministrationUpgrade(input)).toEqual({ state: 'UPGRADED' });
    expect(await prepareProductionCatalogUpgrade(input)).toEqual({ state: 'UPGRADED' });
    if (targetSchema >= 17) {
      expect(await prepareProductionCatalogUpgrade({...input, targetSchema:17})).toEqual({state:'UPGRADED'});
      if (targetSchema === 18) expect(await prepareProductionCatalogUpgrade({...input, targetSchema:18})).toEqual({state:'UPGRADED'});
    }
    db = new Database(dbPath);
    const orm = drizzle(db, { schema }),
      repo = new AuthRepository(orm),
      floor = await store.load();
    db.prepare(
      "INSERT INTO devices(id,tenant_id,location_id,name,device_type,status,session_timeout_minutes,created_at) VALUES(?,?,?,'POS','POS','ACTIVE',60,1)",
    ).run(deviceId, binding.tenantId, binding.locationId);
    const token = 'catalog-fixture-token',
      sessionId = id(),
      now = new Date();
    repo.createSession({
      id: sessionId,
      userId: ownerId,
      deviceId,
      tenantId: binding.tenantId,
      locationId: binding.locationId,
      tokenHash: hashSessionToken(token),
      loginAt: now,
      lastActivity: now,
      expiresAt: new Date(Date.now() + 60000),
      security: {
        trustDomainId: floor.personnel!.trustDomainId,
        credentialRevision: 1,
        authorizationRevision: 1,
        sessionRevision: 1,
        issuedRecoveryEpoch: 0,
      },
    });
    const auth = new AuthService(repo, binding.tenantId, binding.locationId, store);
    const guard = new AuthGuard(auth, 'enforced');
    app.register(
      taxAdministrationRoutes(
        new TaxAdministrationService(new TaxAdministrationRepository(orm), binding, auth),
        guard,
      ),
    );
    const licensing = new EdgeLicenseManager(
      new EdgeControlRepository(orm),
      null,
      {
        enforcementEnabled: false,
        publicKeyring: {},
        pullIntervalMs: 1,
        maxBackoffMs: 1,
        checkpointIntervalMs: 1,
      },
      binding,
    );
    app.register(
      administrationRoutes(
        new AdministrationService(
          new RestaurantAdministrationRepository(orm),
          binding,
          licensing,
          auth,
        ),
        guard,
      ),
    );
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler(errorHandler);
    app.register(
      catalogRoutes(
        new CatalogService(new CatalogRepository(orm)),
        new AuthGuard(auth, 'enforced'),
        new CatalogCommandService(db, binding, auth),
      ),
      { prefix: '/catalog' },
    );
    const headers = { authorization: `Bearer ${token}` },
      payload = {
        commandId: id(),
        kind: 'CREATE_CATEGORY',
        expectedVersion: 0,
        payload: { name: 'Food' },
      };
    const first = await app.inject({ method: 'POST', url: '/catalog/commands', headers, payload });
    expect(first.statusCode, first.body).toBe(200);
    const state=await app.inject({method:'GET',url:'/catalog/state',headers});
    expect(state.statusCode).toBe(200);expect(state.json()).toEqual({capabilityVersion:1,catalogGeneration:1,recoveryEpoch:0});
    expect((await app.inject({method:'GET',url:'/catalog/state'})).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/catalog/commands', headers, payload })).json(),
    ).toEqual(first.json());
    const legacy = await app.inject({
      method: 'PATCH',
      url: `/catalog/products/${id()}/availability`,
      headers,
      payload: { available: false },
    });
    expect(legacy.json().error).toBe('CLIENT_CAPABILITY_REQUIRED');
    const unknown = await app.inject({
      method: 'POST',
      url: '/catalog/commands',
      headers,
      payload: { ...payload, tenantId: binding.tenantId },
    });
    expect(unknown.statusCode).toBe(400);
    if (targetSchema === 18) {
      expect((await store.load())?.minimumSchemaVersion).toBe(18);
      expect((await store.load())?.recoveryState).toBe('NORMAL');
      const empty = await app.inject({method:'GET',url:'/catalog/modifiers',headers});
      expect(empty.statusCode,empty.body).toBe(200);
      expect(empty.json().groups).toEqual([]);
      const createGroup = {commandId:id(),kind:'CREATE_MODIFIER_GROUP',expectedVersion:0,
        payload:{name:'Extras',minSelections:0,maxSelections:3,active:true}};
      const createdGroup = await app.inject({method:'POST',url:'/catalog/commands',headers,payload:createGroup});
      expect(createdGroup.statusCode,createdGroup.body).toBe(200);
      expect(createdGroup.json()).toMatchObject({changed:true,version:1});
      const readBack = await app.inject({method:'GET',url:'/catalog/modifiers',headers});
      expect(readBack.statusCode,readBack.body).toBe(200);
      expect(readBack.json().groups).toEqual([expect.objectContaining({id:createdGroup.json().entityId,name:'Extras',version:1,minSelections:0,maxSelections:3,options:[]})]);
      // Reload through a fresh HTTP application, Auth repository and file connection.
      const reopenedDb = new Database(dbPath,{fileMustExist:true}), reopenedApp=Fastify();
      try {
        const reopenedOrm=drizzle(reopenedDb,{schema});
        const reopenedAuth=new AuthService(new AuthRepository(reopenedOrm),binding.tenantId,binding.locationId,store);
        reopenedApp.setValidatorCompiler(validatorCompiler);
        reopenedApp.setSerializerCompiler(serializerCompiler);
        reopenedApp.setErrorHandler(errorHandler);
        reopenedApp.register(catalogRoutes(new CatalogService(new CatalogRepository(reopenedOrm)),new AuthGuard(reopenedAuth,'enforced'),new CatalogCommandService(reopenedDb,binding,reopenedAuth)),{prefix:'/catalog'});
        const reloaded=await reopenedApp.inject({method:'GET',url:'/catalog/modifiers',headers});
        expect(reloaded.statusCode,reloaded.body).toBe(200);
        expect(reloaded.json()).toEqual(readBack.json());
      } finally {await reopenedApp.close();reopenedDb.close();}
    }
    const profileId = id();
    db.prepare(
      "INSERT INTO tax_profiles(id,name,rate_basis_points,calculation_mode) VALUES(?,'Tax',0,'TAX_ADDED')",
    ).run(profileId);
    db.prepare(
      "INSERT INTO tax_profile_revisions(tax_profile_id,revision,rate_basis_points,calculation_mode,created_at) VALUES(?,1,0,'TAX_ADDED',1)",
    ).run(profileId);
    db.prepare('UPDATE operational_configuration SET currency=?,default_tax_profile_id=?').run(
      'MXN',
      profileId,
    );
    const product = await app.inject({
      method: 'POST',
      url: '/catalog/commands',
      headers,
      payload: {
        kind: 'CREATE_PRODUCT',
        commandId: id(),
        expectedVersion: 0,
        payload: { name: 'Food', basePrice: { amount: 100, currency: 'MXN' } },
      },
    });
    expect(product.statusCode, product.body).toBe(200);
    const assignmentRequests = [
      {
        url: '/administration/taxes/commands',
        payload: {
          kind: 'ASSIGN_PRODUCT_TAX_PROFILE',
          commandId: id(),
          expectedVersion: 1,
          productId: product.json().entityId,
          profileId,
          profileVersion: 1,
          reason: 'Assign tax',
        },
        permission: 'TAX_PROFILE_MANAGE',
      },
      {
        url: '/administration/commands',
        payload: {
          kind: 'ASSIGN_PRODUCT_STATION',
          commandId: id(),
          expectedVersion: 1,
          productId: product.json().entityId,
          stationId: null,
          reason: 'Clear station',
        },
        permission: 'STATION_MANAGE',
      },
    ];
    for (const request of assignmentRequests) {
      const response = await app.inject({
        method: 'POST',
        url: request.url,
        headers,
        payload: request.payload,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({
        version: 1,
        catalogGeneration: targetSchema === 18 ? 3 : 2,
        changed: false,
        recoveryEpoch: 0,
      });
      expect(
        (
          await app.inject({ method: 'POST', url: request.url, headers, payload: request.payload })
        ).json(),
      ).toEqual(response.json());
      db.prepare('DELETE FROM role_permissions WHERE permission_code=?').run(request.permission);
      const retry = await app.inject({
        method: 'POST',
        url: request.url,
        headers,
        payload: request.payload,
      });
      expect(retry.statusCode, retry.body).toBe(403);
      expect(retry.json().error).toBe('PERMISSION_DENIED');
    }
    if(targetSchema===18){
      const assignment={kind:'SET_PRODUCT_MODIFIERS',commandId:id(),entityId:product.json().entityId,expectedVersion:1,payload:{assignments:[]}};
      const allowed=await app.inject({method:'POST',url:'/catalog/commands',headers,payload:assignment});
      expect(allowed.statusCode,allowed.body).toBe(200);expect(allowed.json()).toMatchObject({changed:false,version:1});
      expect((await app.inject({method:'POST',url:'/catalog/commands',headers,payload:assignment})).json()).toEqual(allowed.json());
    }
    // Effective mutations as well as the no-op/retry checks above, on every schema.
    db.exec("INSERT OR IGNORE INTO role_permissions SELECT id,'TAX_PROFILE_MANAGE' FROM roles WHERE name='OWNER'; INSERT OR IGNORE INTO role_permissions SELECT id,'STATION_MANAGE' FROM roles WHERE name='OWNER'");
    const otherProfile=id(), station=id();
    db.prepare("INSERT INTO tax_profiles(id,name,rate_basis_points,calculation_mode,version) VALUES(?,'Other tax',1600,'TAX_ADDED',1)").run(otherProfile);
    db.prepare("INSERT INTO tax_profile_revisions(tax_profile_id,revision,rate_basis_points,calculation_mode,created_at) VALUES(?,1,1600,'TAX_ADDED',1)").run(otherProfile);
    db.prepare("INSERT INTO stations(id,tenant_id,location_id,name) VALUES(?,?,?,'Kitchen')").run(station,binding.tenantId,binding.locationId);
    for(const [url,mutation] of [
      ['/administration/taxes/commands',{kind:'ASSIGN_PRODUCT_TAX_PROFILE',commandId:id(),expectedVersion:1,productId:product.json().entityId,profileId:otherProfile,profileVersion:1,reason:'Effective tax assignment'}],
      ['/administration/commands',{kind:'ASSIGN_PRODUCT_STATION',commandId:id(),expectedVersion:2,productId:product.json().entityId,stationId:station,stationVersion:1,reason:'Effective station assignment'}],
    ] as const) {
      const response=await app.inject({method:'POST',url,headers,payload:mutation});
      expect(response.statusCode,response.body).toBe(200);
      expect(response.json()).toMatchObject({changed:true,version:mutation.expectedVersion+1});
      expect((await app.inject({method:'POST',url,headers,payload:mutation})).json()).toEqual(response.json());
    }
    expect(db.prepare('SELECT tax_profile_id tax,station_id station,version FROM products WHERE id=?').get(product.json().entityId)).toEqual({tax:otherProfile,station,version:3});
    db.prepare("DELETE FROM role_permissions WHERE permission_code='CATALOG_MANAGE'").run();
    const denied = await app.inject({ method: 'POST', url: '/catalog/commands', headers, payload });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toBe('PERMISSION_DENIED');
    expect(db.prepare('SELECT count(*) n FROM catalog_command_receipts').get()).toEqual({ n: targetSchema===18?4:2 });
    const modifiers = await app.inject({method:'GET',url:'/catalog/modifiers',headers});
    expect(modifiers.statusCode, modifiers.body).toBe(targetSchema === 18 ? 200 : 409);
    if (targetSchema === 18) expect(modifiers.json()).toEqual({currency:'MXN',groups:[expect.objectContaining({name:'Extras',version:1})]});
    const productModifiers=await app.inject({method:'GET',url:`/catalog/products/${product.json().entityId}/modifiers`,headers});
    expect(productModifiers.statusCode).toBe(targetSchema===18?200:409);
    if(targetSchema===18)expect(productModifiers.json()).toMatchObject({version:3,assignments:[],groups:[]});
    if(targetSchema===18)expect((await app.inject({method:'POST',url:'/catalog/commands',headers,payload:{kind:'SET_PRODUCT_MODIFIERS',commandId:id(),entityId:product.json().entityId,expectedVersion:3,payload:{assignments:[]}}})).statusCode).toBe(403);
    expect((await app.inject({method:'GET',url:'/catalog/modifiers'})).statusCode).toBe(401);
    db.prepare("DELETE FROM role_permissions WHERE permission_code='CATALOG_VIEW'").run();
    expect((await app.inject({method:'GET',url:'/catalog/modifiers',headers})).statusCode).toBe(403);
  } finally {
    await app.close();
    db?.close();
    await rm(root, { recursive: true, force: true });
  }
});
