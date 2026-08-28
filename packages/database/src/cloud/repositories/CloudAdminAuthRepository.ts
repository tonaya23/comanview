import type { Pool } from 'pg';
import type { CloudAdminRole } from '@comanview/auth';

export interface CloudAdminUserRecord {
  userId: string;
  email: string;
  displayName: string;
  credentialHash: string;
  role: CloudAdminRole;
  status: 'ACTIVE' | 'INACTIVE';
  failedLoginCount: number;
  lockedUntil: Date | null;
}

export interface CloudAdminSessionRecord {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  role: CloudAdminRole;
  userStatus: 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  tenantGrants: string[];
}

interface UserRow {
  user_id: string;
  email: string;
  display_name: string;
  credential_hash: string;
  role: CloudAdminRole;
  status: 'ACTIVE' | 'INACTIVE';
  failed_login_count: number;
  locked_until: Date | null;
}

export class CloudAdminAuthRepository {
  constructor(private readonly pool: Pool) {}

  async findUserByEmail(email: string): Promise<CloudAdminUserRecord | null> {
    const result = await this.pool.query<UserRow>(
      `SELECT user_id, email, display_name, credential_hash, role, status,
              failed_login_count, locked_until
       FROM cloud_admin_users
       WHERE lower(email) = lower($1)`,
      [email],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async recordFailedLogin(input: {
    userId: string;
    maxAttempts: number;
    lockoutMs: number;
    now: Date;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE cloud_admin_users
       SET failed_login_count = CASE
             WHEN locked_until IS NOT NULL AND locked_until <= $4 THEN 1
             ELSE failed_login_count + 1
           END,
           locked_until = CASE
             WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= $4 THEN 1
                        ELSE failed_login_count + 1 END) >= $2
             THEN $4 + ($3 * interval '1 millisecond')
             ELSE NULL
           END,
           updated_at = $4
       WHERE user_id = $1`,
      [input.userId, input.maxAttempts, input.lockoutMs, input.now],
    );
  }

  async resetFailedLogin(userId: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE cloud_admin_users
       SET failed_login_count = 0, locked_until = NULL, updated_at = $2
       WHERE user_id = $1`,
      [userId, now],
    );
  }

  async createSession(input: {
    sessionId: string;
    userId: string;
    tokenHash: string;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO cloud_admin_sessions
         (session_id, user_id, token_hash, created_at, last_activity_at, expires_at)
       VALUES ($1, $2, $3, $4, $4, $5)`,
      [input.sessionId, input.userId, input.tokenHash, input.createdAt, input.expiresAt],
    );
  }

  async findSessionByTokenHash(tokenHash: string): Promise<CloudAdminSessionRecord | null> {
    const result = await this.pool.query<{
      session_id: string;
      user_id: string;
      email: string;
      display_name: string;
      role: CloudAdminRole;
      user_status: 'ACTIVE' | 'INACTIVE';
      created_at: Date;
      last_activity_at: Date;
      expires_at: Date;
      revoked_at: Date | null;
      tenant_grants: string[];
    }>(
      `SELECT session.session_id, session.user_id, users.email, users.display_name,
              users.role, users.status AS user_status, session.created_at,
              session.last_activity_at, session.expires_at, session.revoked_at,
              COALESCE(array_agg(grants.tenant_id::text)
                FILTER (WHERE grants.tenant_id IS NOT NULL), '{}') AS tenant_grants
       FROM cloud_admin_sessions session
       JOIN cloud_admin_users users ON users.user_id = session.user_id
       LEFT JOIN cloud_admin_tenant_grants grants ON grants.user_id = users.user_id
       WHERE session.token_hash = $1
       GROUP BY session.session_id, session.user_id, users.email, users.display_name,
                users.role, users.status, session.created_at, session.last_activity_at,
                session.expires_at, session.revoked_at`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row
      ? {
          sessionId: row.session_id,
          userId: row.user_id,
          email: row.email,
          displayName: row.display_name,
          role: row.role,
          userStatus: row.user_status,
          createdAt: row.created_at,
          lastActivityAt: row.last_activity_at,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
          tenantGrants: row.tenant_grants,
        }
      : null;
  }

  async touchSession(sessionId: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE cloud_admin_sessions SET last_activity_at = $2
       WHERE session_id = $1 AND revoked_at IS NULL`,
      [sessionId, now],
    );
  }

  async revokeSession(sessionId: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE cloud_admin_sessions SET revoked_at = COALESCE(revoked_at, $2)
       WHERE session_id = $1`,
      [sessionId, now],
    );
  }

  async provisionDevelopmentAdmin(input: {
    userId: string;
    email: string;
    displayName: string;
    credentialHash: string;
    role: CloudAdminRole;
    tenantIds: string[];
    now: Date;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query<{ user_id: string }>(
        `INSERT INTO cloud_admin_users
           (user_id, email, display_name, credential_hash, role, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$6)
         ON CONFLICT (lower(email)) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           credential_hash = EXCLUDED.credential_hash,
           role = EXCLUDED.role,
           status = 'ACTIVE',
           updated_at = EXCLUDED.updated_at
         RETURNING user_id`,
        [
          input.userId,
          input.email.toLowerCase(),
          input.displayName,
          input.credentialHash,
          input.role,
          input.now,
        ],
      );
      const userId = user.rows[0]!.user_id;
      await client.query('DELETE FROM cloud_admin_tenant_grants WHERE user_id = $1', [userId]);
      for (const tenantId of input.tenantIds) {
        await client.query(
          `INSERT INTO cloud_admin_tenant_grants (user_id, tenant_id, created_at)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [userId, tenantId, input.now],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapUser(row: UserRow): CloudAdminUserRecord {
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    credentialHash: row.credential_hash,
    role: row.role,
    status: row.status,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
  };
}
