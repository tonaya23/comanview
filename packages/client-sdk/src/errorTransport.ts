import { PublicErrorDetailsSchema, type PublicErrorDetails } from '@comanview/contracts';

interface HeadersLike {
  get(name: string): string | null;
}

export function diagnosticDetails(headers?: HeadersLike, body?: unknown): PublicErrorDetails | undefined {
  const nested = body && typeof body === 'object' && 'details' in body &&
    body.details && typeof body.details === 'object' && 'diagnosticId' in body.details
    ? body.details.diagnosticId
    : null;
  const diagnosticId = headers?.get('x-request-id') ?? headers?.get('x-correlation-id') ?? nested;
  if (!diagnosticId) return undefined;
  const parsed = PublicErrorDetailsSchema.safeParse({ diagnosticId });
  return parsed.success ? parsed.data : undefined;
}
