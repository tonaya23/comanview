import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertDocumentBinding, signControlDocument, verifyControlDocument } from '../index.js';

describe('signed control documents', () => {
  it('signs and verifies an edge-bound Ed25519 license using kid', () => {
    const pair = generateKeyPairSync('ed25519');
    const privateKey = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const publicKey = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const envelope = signControlDocument(
      {
        documentType: 'LICENSE', formatVersion: 1,
        documentId: '01991a00-0000-7000-8000-000000000001', revision: 1,
        tenantId: '01991a00-0000-7000-8000-000000000002',
        locationId: '01991a00-0000-7000-8000-000000000003',
        edgeId: '01991a00-0000-7000-8000-000000000004',
        issuedAt: '2026-08-29T00:00:00.000Z', expiresAt: '2026-09-05T00:00:00.000Z',
        graceUntil: '2026-09-26T00:00:00.000Z', declaredState: 'ACTIVE',
        planCode: 'TECHNICAL_TEST', capabilities: ['CORE_POS'],
      },
      'current-2026', privateKey,
    );
    const verified = verifyControlDocument(envelope, { 'current-2026': publicKey });
    expect(verified.payload.documentType).toBe('LICENSE');
    expect(verified.header.kid).toBe('current-2026');
  });

  it('rejects an unknown key id without accepting the document', () => {
    const pair = generateKeyPairSync('ed25519');
    const envelope = signControlDocument(
      {
        documentType: 'CONFIGURATION', formatVersion: 1,
        documentId: '01991a00-0000-7000-8000-000000000001', revision: 1,
        tenantId: '01991a00-0000-7000-8000-000000000002',
        locationId: '01991a00-0000-7000-8000-000000000003',
        edgeId: '01991a00-0000-7000-8000-000000000004',
        issuedAt: '2026-08-29T00:00:00.000Z',
        configuration: { payment: { tipsEnabled: true, tipPercentageOptionsBasisPoints: [1000] } },
      },
      'next-2026', pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    );
    expect(() => verifyControlDocument(envelope, {})).toThrow('CONTROL_DOCUMENT_UNKNOWN_KID');
  });

  it('rejects tampering and a document bound to another Edge', () => {
    const pair = generateKeyPairSync('ed25519');
    const privateKey = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const publicKey = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const envelope = signControlDocument({
      documentType: 'FEATURE_FLAGS', formatVersion: 1,
      documentId: '01991a00-0000-7000-8000-000000000011', revision: 1,
      tenantId: '01991a00-0000-7000-8000-000000000012',
      locationId: '01991a00-0000-7000-8000-000000000013',
      edgeId: '01991a00-0000-7000-8000-000000000014',
      issuedAt: '2026-08-29T00:00:00.000Z', flags: {},
    }, 'current', privateKey);
    expect(() => verifyControlDocument({ ...envelope, signature: `${envelope.signature}x` },
      { current: publicKey })).toThrow('CONTROL_DOCUMENT_INVALID_SIGNATURE');
    const verified = verifyControlDocument(envelope, { current: publicKey });
    expect(() => assertDocumentBinding(verified.payload, {
      tenantId: verified.payload.tenantId, locationId: verified.payload.locationId,
      edgeId: '01991a00-0000-7000-8000-000000000099',
    })).toThrow('CONTROL_DOCUMENT_BINDING_MISMATCH');
  });
});
