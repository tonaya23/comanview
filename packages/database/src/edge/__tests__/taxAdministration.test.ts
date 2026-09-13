import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EntityId } from '@comanview/domain';
import type { TaxAdministrationCommand } from '@comanview/contracts';
import * as schema from '../schema.js';
import { TaxAdministrationRepository } from '../repositories/TaxAdministrationRepository.js';
import type { NewAuditEntry } from '../repositories/AuditRepository.js';

const directory = fileURLToPath(new URL('../../../../../migrations/edge/', import.meta.url));
const id = () => EntityId.generate().toString();
function fixture() {
  const db = new Database(':memory:');
  for (const name of readdirSync(directory).filter(f => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) <= 15).sort())
    db.exec(readFileSync(join(directory, name), 'utf8'));
  const binding = { tenantId: id(), locationId: id(), edgeId: id() };
  db.prepare("INSERT INTO edge_installations(singleton_key,edge_id,tenant_id,location_id,created_at) VALUES('PRIMARY',?,?,?,1)")
    .run(binding.edgeId, binding.tenantId, binding.locationId);
  db.prepare('INSERT INTO operational_configuration(location_id,tenant_id,updated_at) VALUES(?,?,1)').run(binding.locationId, binding.tenantId);
  const repo = new TaxAdministrationRepository(drizzle(db, { schema }));
  const audit = (commandId: string): NewAuditEntry => ({ auditId: id(), occurredAt: new Date(),
    tenantId: binding.tenantId, locationId: binding.locationId, deviceId: id(), sessionId: id(), actorUserId: id(),
    actorRole: 'OWNER', authorizedByUserId: null, authorizedByRole: null, action: 'TAX_CONFIGURATION_CHANGED',
    entityType: 'TAX_PROFILE', entityId: id(), outcome: 'SUCCESS', reason: 'Tax setup', commandId,
    before: null, after: null, amountAffected: null, currency: null, eventId: null });
  const run = (command: TaxAdministrationCommand) => repo.execute(command, binding, audit(command.commandId));
  const create = (rate = 1600) => run({ kind: 'CREATE_TAX_PROFILE', commandId: id(), expectedVersion: 0, reason: 'Initial tax',
    name: 'Tax', rateBasisPoints: rate, calculationMode: 'TAX_ADDED' });
  return { db, binding, repo, audit, run, create };
}

describe('tax administration transactional persistence', () => {
  it('creates explicit zero tax, with a single result/Audit/Outbox on command retry', () => {
    const f = fixture();
    try {
      const command = { kind: 'CREATE_TAX_PROFILE', commandId: id(), expectedVersion: 0, reason: 'Exempt tax',
        name: 'Exempt', rateBasisPoints: 0, calculationMode: 'TAX_ADDED' } as const;
      const first = f.run(command);
      expect(f.run(command)).toEqual(first);
      for (const table of ['tax_profiles', 'tax_profile_revisions', 'audit_log', 'event_log', 'administration_command_receipts'])
        expect(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 1 });
      expect(() => f.run({ ...command, rateBasisPoints: 800 })).toThrow('COMMAND_ID_CONFLICT');
    } finally { f.db.close(); }
  });
  it('appends revisions and rejects OCC conflicts without rewriting assigned Products', () => {
    const f = fixture();
    try {
      const tax = f.create(); const productId = id();
      f.db.prepare('INSERT INTO products(id,name,tax_profile_id,base_price_amount,base_price_currency) VALUES(?,?,?,10000,?)')
        .run(productId, 'Meal', tax.entityId, 'MXN');
      const product = f.db.prepare('SELECT * FROM products').get();
      const command = { kind: 'REVISE_TAX_PROFILE', profileId: tax.entityId, commandId: id(), expectedVersion: 1,
        reason: 'New rate', name: 'Tax', rateBasisPoints: 800, calculationMode: 'TAX_ADDED' } as const;
      expect(f.run(command).version).toBe(2);
      expect(f.db.prepare('SELECT rate_basis_points AS rate FROM tax_profile_revisions ORDER BY revision').all()).toEqual([{ rate: 1600 }, { rate: 800 }]);
      expect(f.db.prepare('SELECT * FROM products').get()).toEqual(product);
      expect(() => f.run({ ...command, commandId: id() })).toThrow('ADMINISTRATION_VERSION_CONFLICT');
      expect(() => f.db.prepare('UPDATE tax_profile_revisions SET rate_basis_points=1').run()).toThrow('TAX_REVISION_IMMUTABLE');
    } finally { f.db.close(); }
  });
  it('requires an active explicit default and blocks deactivation of a used profile', () => {
    const f = fixture();
    try {
      const tax = f.create();
      f.run({ kind: 'SET_DEFAULT_TAX_PROFILE', profileId: tax.entityId, commandId: id(), expectedVersion: 1, reason: 'Use default tax' });
      expect(f.db.prepare('SELECT fiscal_policy_version AS policy,default_tax_profile_id AS id FROM operational_configuration').get())
        .toEqual({ policy: 1, id: tax.entityId });
      expect(() => f.run({ kind: 'DEACTIVATE_TAX_PROFILE', profileId: tax.entityId, commandId: id(), expectedVersion: 1, reason: 'Remove tax' })).toThrow('TAX_PROFILE_IN_USE');
    } finally { f.db.close(); }
  });
  it('rolls back the revision and Outbox when required Audit fails', () => {
    const f = fixture();
    try {
      const tax = f.create();
      f.db.exec("CREATE TRIGGER fail_tax_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'test audit failure'); END");
      expect(() => f.run({ kind: 'REVISE_TAX_PROFILE', profileId: tax.entityId, commandId: id(), expectedVersion: 1,
        reason: 'New rate', name: 'Tax', rateBasisPoints: 800, calculationMode: 'TAX_ADDED' })).toThrow();
      expect(f.db.prepare('SELECT version,rate_basis_points AS rate FROM tax_profiles').get()).toEqual({ version: 1, rate: 1600 });
      expect(f.db.prepare('SELECT count(*) AS n FROM event_log').get()).toEqual({ n: 1 });
      expect(f.db.prepare('SELECT count(*) AS n FROM tax_profile_revisions').get()).toEqual({ n: 1 });
    } finally { f.db.close(); }
  });
  it('does not reuse a pre-restore command receipt at another recoveryEpoch', () => {
    const f = fixture();
    try {
      const command = { kind: 'CREATE_TAX_PROFILE', commandId: id(), expectedVersion: 0, reason: 'Initial tax',
        name: 'Tax', rateBasisPoints: 1600, calculationMode: 'TAX_ADDED' } as const;
      f.run(command);
      f.db.prepare('UPDATE edge_installations SET recovery_epoch=1').run();
      expect(() => f.run(command)).toThrow('COMMAND_ID_CONFLICT');
    } finally { f.db.close(); }
  });
});
