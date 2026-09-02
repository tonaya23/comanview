import { z } from 'zod';

export const PermissionSchema = z.enum([
  'CATALOG_VIEW',
  'CATALOG_MANAGE',
  'ORDER_VIEW',
  'ORDER_CREATE',
  'ORDER_EDIT_DRAFT',
  'ORDER_SEND',
  'ORDER_CLOSE',
  'ORDER_CANCEL',
  'ORDER_CANCEL_EMPTY',
  'ORDER_REQUEST_PAYMENT',
  'CASH_SESSION_VIEW',
  'CASH_SESSION_OPEN',
  'CASH_MOVEMENT_CREATE',
  'CASH_REPORT_X',
  'CASH_SESSION_CLOSE',
  'PAYMENT_CONFIG_VIEW',
  'PAYMENT_CREATE',
  'PAYMENT_VOID',
  'PRINT_PRECHECK',
  'PRINT_RECEIPT',
  'PRINT_JOBS_VIEW',
  'KDS_VIEW',
  'KDS_UPDATE_PREPARATION',
  'AUDIT_VIEW',
  'DEVICE_VIEW',
  'DEVICE_PAIR',
  'DEVICE_REVOKE',
  'INSTALLATION_READINESS_VIEW',
  'BACKUP_VIEW','BACKUP_CREATE','RECOVERY_VIEW','RECOVERY_EXECUTE',
]);
export const PermissionCodes = PermissionSchema.enum;

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1),
  status: z.literal('ACTIVE'),
  roles: z.array(z.string().min(1)),
  permissions: z.array(PermissionSchema),
});

export const LocalSessionSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().uuid(),
  loginAt: z.string().datetime(),
  lastActivity: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const LoginRequestSchema = z.object({
  pin: z.string().regex(/^\d{4,12}$/),
  deviceId: z.string().uuid(),
  deviceCredential: z.string().min(43).max(512),
});

export const LoginResponseSchema = z.object({
  token: z.string().min(32),
  user: AuthUserSchema,
  session: LocalSessionSchema,
});

export const CurrentSessionResponseSchema = z.object({
  user: AuthUserSchema,
  session: LocalSessionSchema,
});

export const LogoutResponseSchema = z.object({ revoked: z.literal(true) });

export type PermissionCode = z.infer<typeof PermissionSchema>;
export type AuthUserResponse = z.infer<typeof AuthUserSchema>;
export type LocalSessionResponse = z.infer<typeof LocalSessionSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type CurrentSessionResponse = z.infer<typeof CurrentSessionResponseSchema>;
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;
