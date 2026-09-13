import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASE_ROLE_PERMISSIONS, type BaseRole } from '@comanview/auth';
import * as schema from '../schema.js';
import { AuthRepository } from '../repositories/AuthRepository.js';

const directory = fileURLToPath(new URL('../../../../../migrations/edge/', import.meta.url));
describe('administration grants remain explicitly bounded', () => {
  it('migration grants match the new permissions and forged MANAGER grants do not elevate authentication', () => {
    const db = new Database(':memory:');
    try {
      const files = readdirSync(directory).filter(f => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) <= 15).sort();
      for (const name of files.filter(f => !f.startsWith('0015'))) db.exec(readFileSync(join(directory, name), 'utf8'));
      for (const role of Object.keys(BASE_ROLE_PERMISSIONS))
        db.prepare('INSERT OR IGNORE INTO roles(id,name) VALUES(?,?)').run(role, role);
      db.exec(readFileSync(join(directory, files.find(f => f.startsWith('0015'))!), 'utf8'));
      const newPermissions = db.prepare("SELECT code FROM permissions WHERE code LIKE '%MANAGE' OR code IN ('ADMINISTRATION_VIEW','PERSONNEL_VIEW','PERSONNEL_RECOVERY','OWN_PIN_CHANGE')")
        .all() as Array<{ code: string }>;
      for (const role of Object.keys(BASE_ROLE_PERMISSIONS) as BaseRole[]) {
        const grants = db.prepare('SELECT rp.permission_code AS code FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.name=?')
          .all(role) as Array<{ code: string }>;
        for (const permission of newPermissions.filter(p => p.code !== 'CATALOG_MANAGE'))
          expect(grants.some(g => g.code === permission.code)).toBe(BASE_ROLE_PERMISSIONS[role].some(p => p === permission.code));
      }
      db.prepare("INSERT INTO users(id,tenant_id,location_id,display_name,status,pin_hash,created_at) VALUES('u','t','l','Manager','ACTIVE','test-only',1)").run();
      db.prepare("INSERT INTO user_roles(user_id,role_id) SELECT 'u',id FROM roles WHERE name='MANAGER'").run();
      db.prepare("INSERT OR IGNORE INTO role_permissions(role_id,permission_code) SELECT id,'TAX_PROFILE_MANAGE' FROM roles WHERE name='MANAGER'").run();
      const repo = new AuthRepository(drizzle(db, { schema }));
      const authorization = repo.getUserAuthorization(repo.listUsersForLogin('t', 'l')[0]!);
      expect(authorization.permissions).toContain('PERSONNEL_MANAGE');
      expect(authorization.permissions).not.toContain('TAX_PROFILE_MANAGE');
      expect(authorization.permissions).not.toContain('PERSONNEL_RECOVERY');
    } finally { db.close(); }
  });
});
