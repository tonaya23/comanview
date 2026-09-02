import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.enum(['UP', 'DOWN', 'DEGRADED']),
  edgeService: z.object({
    status: z.enum(['OK', 'ERROR']),
    version: z.string().optional(),
    timestamp: z.string(),
  }),
  database: z.object({
    status: z.enum(['OK', 'ERROR']),
  }),
  recoveryState:z.enum(['NORMAL','RECOVERY_REQUIRED','RECOVERY_IN_PROGRESS']).optional(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
