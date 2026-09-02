import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@comanview/database/edge';
import { EdgeControlRepository } from '@comanview/database';
import {
  LicenseDocumentPayloadSchema,
  SignedDocumentEnvelopeSchema,
  type LicenseDocumentPayload,
  type SignedDocumentEnvelope,
} from '@comanview/contracts';
import { assertDocumentBinding, hashSignedEnvelope } from '@comanview/licensing';
import type { RecoverySecurityFloor } from '../backup/RecoverySecurityStore.js';

export function stageLicense(
  sqlite: Database.Database,
  payload: LicenseDocumentPayload,
  envelope: SignedDocumentEnvelope,
  hash: string,
  now: Date,
) {
  const repo = new EdgeControlRepository(drizzle(sqlite, { schema }));
  const current = repo.currentDocument('LICENSE');
  if (
    current &&
    (current.revision > payload.revision ||
      (current.revision === payload.revision && current.documentHash !== hash))
  )
    throw new Error('LICENSE_SQLITE_REVISION_CONFLICT');
  const prior = sqlite
    .prepare(
      'SELECT document_hash hash FROM edge_control_documents WHERE document_id=? OR (document_type=? AND revision=?)',
    )
    .get(payload.documentId, 'LICENSE', payload.revision) as { hash: string } | undefined;
  if (prior) {
    if (prior.hash !== hash) throw new Error('CONTROL_DOCUMENT_REVISION_HASH_CONFLICT');
    return;
  }
  sqlite
    .prepare(
      `INSERT INTO edge_control_documents(document_id,document_type,revision,document_hash,envelope_json,payload_json,
    issued_at,expires_at,grace_until,received_at,is_current) VALUES(?,'LICENSE',?,?,?,?,?,?,?,?,0)`,
    )
    .run(
      payload.documentId,
      payload.revision,
      hash,
      JSON.stringify(envelope),
      JSON.stringify(payload),
      Date.parse(payload.issuedAt),
      Date.parse(payload.expiresAt),
      Date.parse(payload.graceUntil),
      now.getTime(),
    );
}

/** Synchronous activation after the durable floor decision; also used to finish an interrupted commit. */
export function activateLicense(
  sqlite: Database.Database,
  payload: LicenseDocumentPayload,
  envelope: SignedDocumentEnvelope,
  hash: string,
  now: Date,
) {
  const repo = new EdgeControlRepository(drizzle(sqlite, { schema }));
  sqlite.transaction(() => {
    const old = repo.currentDocument<LicenseDocumentPayload>('LICENSE');
    if (old?.documentHash === hash) return;
    if (old && old.revision >= payload.revision)
      throw new Error('LICENSE_SQLITE_REVISION_CONFLICT');
    const reductions = old
      ? old.payload.capabilities.filter((c) => !payload.capabilities.includes(c))
      : [];
    const expansions = old
      ? payload.capabilities.filter((c) => !old.payload.capabilities.includes(c))
      : payload.capabilities;
    const open = repo.getOpenCashSession();
    const clears =
      ['ACTIVE', 'PAST_DUE', 'GRACE_PERIOD'].includes(payload.declaredState) &&
      reductions.length === 0 &&
      (!old ||
        ['SUSPENDED', 'TERMINATED'].includes(old.payload.declaredState) ||
        expansions.length > 0);
    sqlite
      .prepare(
        'DELETE FROM edge_control_documents WHERE document_id=? AND is_current=0 AND document_hash=?',
      )
      .run(payload.documentId, hash);
    repo.applyDocument({
      payload,
      envelope,
      documentHash: hash,
      receivedAt: now,
      ...(reductions.length
        ? {
            protectedCapabilities: [
              ...new Set([
                ...repo.getRuntime().protectedCapabilities,
                ...old!.payload.capabilities,
              ]),
            ],
          }
        : {}),
      ...(reductions.length && !open ? { restrictionStartedAt: now } : {}),
      ...(clears ? { clearProtectedCapabilities: true } : {}),
    });
    if (reductions.length && !open) repo.captureOpenOrders(payload.revision, now);
  })();
}

/** Floor hash authenticates the exact envelope previously verified by the specialized writer. */
export function reconcileLicenseDecision(sqlite: Database.Database, floor: RecoverySecurityFloor) {
  const decision = floor.licenseDecision;
  if (!decision || decision.revision !== floor.maximumSignedRevisions.LICENSE) return;
  const row = sqlite
    .prepare(
      "SELECT envelope_json envelope FROM edge_control_documents WHERE document_type='LICENSE' AND revision=? AND document_hash=?",
    )
    .get(decision.revision, decision.documentHash) as { envelope: string } | undefined;
  if (row) {
    const envelope = SignedDocumentEnvelopeSchema.parse(JSON.parse(row.envelope));
    if (hashSignedEnvelope(envelope) !== decision.documentHash)
      throw new Error('LICENSE_SECURITY_DECISION_CONFLICT');
    const payload = LicenseDocumentPayloadSchema.parse(
      JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8')),
    );
    if (!floor.binding) throw new Error('RECOVERY_SECURITY_BINDING_MISMATCH');
    assertDocumentBinding(payload, floor.binding);
    const sticky =
      payload.declaredState === 'TERMINATED'
        ? 'TERMINATED'
        : payload.declaredState === 'SUSPENDED'
          ? 'SUSPENDED'
          : null;
    if (payload.revision !== decision.revision || sticky !== decision.stickyDeclaredState)
      throw new Error('LICENSE_SECURITY_DECISION_CONFLICT');
    activateLicense(sqlite, payload, envelope, decision.documentHash, new Date());
  }
  // A restore may not contain the authorized document. Invalidate stale current,
  // keep the external decision, and remain NO_VALID_LICENSE until it is available.
  sqlite
    .prepare(
      "UPDATE edge_control_documents SET is_current=0 WHERE document_type='LICENSE' AND (revision<? OR (revision=? AND document_hash!=?))",
    )
    .run(decision.revision, decision.revision, decision.documentHash);
  sqlite
    .prepare(
      "UPDATE edge_control_runtime SET sticky_declared_state=? WHERE singleton_key='PRIMARY'",
    )
    .run(floor.stickyDeclaredState);
}
