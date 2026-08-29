import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import {
  ConfigurationDocumentPayloadSchema,
  FeatureFlagsDocumentPayloadSchema,
  LicenseDocumentPayloadSchema,
  SignedDocumentEnvelopeSchema,
  SignedDocumentProtectedHeaderSchema,
  type ConfigurationDocumentPayload,
  type FeatureFlagsDocumentPayload,
  type LicenseDocumentPayload,
  type SignedDocumentEnvelope,
} from '@comanview/contracts';

export const LICENSE_DOCUMENT_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;
export const LICENSE_GRACE_DURATION_MS = 21 * 24 * 60 * 60 * 1_000;
export const LICENSE_RENEWAL_WINDOW_MS = 48 * 60 * 60 * 1_000;
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1_000;
export const SUSPICIOUS_RESTART_FORWARD_JUMP_MS = 7 * 24 * 60 * 60 * 1_000;
export const CONTROL_PULL_INTERVAL_MS = 5 * 60 * 1_000;
export const CONTROL_PULL_MAX_BACKOFF_MS = 60 * 60 * 1_000;
export const EFFECTIVE_TIME_CHECKPOINT_MS = 60 * 1_000;

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function parseBase64urlJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
}

export function hashSignedEnvelope(envelope: SignedDocumentEnvelope): string {
  return createHash('sha256').update(JSON.stringify(envelope), 'utf8').digest('hex');
}

export function signControlDocument(
  payload: LicenseDocumentPayload | FeatureFlagsDocumentPayload | ConfigurationDocumentPayload,
  kid: string,
  privateKeyPem: string,
): SignedDocumentEnvelope {
  const protectedValue = base64urlJson({
    typ: payload.documentType,
    formatVersion: 1,
    alg: 'EdDSA',
    kid,
  });
  const payloadValue = base64urlJson(payload);
  const signingInput = Buffer.from(`${protectedValue}.${payloadValue}`, 'ascii');
  const privateKey: KeyObject = createPrivateKey(privateKeyPem);
  return {
    protected: protectedValue,
    payload: payloadValue,
    signature: sign(null, signingInput, privateKey).toString('base64url'),
  };
}

export interface VerifiedControlDocument {
  header: ReturnType<typeof SignedDocumentProtectedHeaderSchema.parse>;
  payload: LicenseDocumentPayload | FeatureFlagsDocumentPayload | ConfigurationDocumentPayload;
  documentHash: string;
}

export function verifyControlDocument(
  input: unknown,
  publicKeyring: Readonly<Record<string, string>>,
): VerifiedControlDocument {
  const envelope = SignedDocumentEnvelopeSchema.parse(input);
  const header = SignedDocumentProtectedHeaderSchema.parse(parseBase64urlJson(envelope.protected));
  const publicKeyPem = publicKeyring[header.kid];
  if (!publicKeyPem) throw new Error('CONTROL_DOCUMENT_UNKNOWN_KID');
  const signingInput = Buffer.from(`${envelope.protected}.${envelope.payload}`, 'ascii');
  const valid = verify(
    null,
    signingInput,
    createPublicKey(publicKeyPem),
    Buffer.from(envelope.signature, 'base64url'),
  );
  if (!valid) throw new Error('CONTROL_DOCUMENT_INVALID_SIGNATURE');
  const rawPayload = parseBase64urlJson(envelope.payload);
  const payload =
    header.typ === 'LICENSE'
      ? LicenseDocumentPayloadSchema.parse(rawPayload)
      : header.typ === 'FEATURE_FLAGS'
        ? FeatureFlagsDocumentPayloadSchema.parse(rawPayload)
        : ConfigurationDocumentPayloadSchema.parse(rawPayload);
  if (payload.documentType !== header.typ) throw new Error('CONTROL_DOCUMENT_TYPE_MISMATCH');
  return { header, payload, documentHash: hashSignedEnvelope(envelope) };
}

export function assertDocumentBinding(
  payload: LicenseDocumentPayload | FeatureFlagsDocumentPayload | ConfigurationDocumentPayload,
  expected: { tenantId: string; locationId: string; edgeId: string },
): void {
  if (
    payload.tenantId !== expected.tenantId ||
    payload.locationId !== expected.locationId ||
    payload.edgeId !== expected.edgeId
  ) {
    throw new Error('CONTROL_DOCUMENT_BINDING_MISMATCH');
  }
}
