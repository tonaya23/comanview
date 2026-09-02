import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { PERMISSIONS } from '@comanview/auth';
import { BackupProtectionStatusSchema, BackupRecordSchema, ConfigureOffDeviceBackupRequestSchema,
  CreateBackupRequestSchema, RecoveryKeyExportRequestSchema, RecoveryKeyExportResponseSchema,
  RestoreBackupRequestSchema,RestoreScheduledResponseSchema } from '@comanview/contracts';
import type { AuthGuard } from '../auth/http/AuthGuard.js';
import { actorFrom } from '../auth/http/AuthGuard.js';
import type { BackupManager } from './BackupManager.js';
import type { RecoveryCoordinator } from './RecoveryCoordinator.js';

export function backupRoutes(manager:BackupManager,guard:AuthGuard,recovery?:RecoveryCoordinator):FastifyPluginAsyncZod{return async(app)=>{
  app.get('/backups/status',{preHandler:guard.requirePermission(PERMISSIONS.BACKUP_VIEW),schema:{response:{200:BackupProtectionStatusSchema}}},async()=>manager.status());
  app.post('/backups',{preHandler:guard.requirePermission(PERMISSIONS.BACKUP_CREATE),schema:{body:CreateBackupRequestSchema,response:{201:BackupRecordSchema}}},async(req,reply)=>reply.status(201).send(await manager.create({commandId:req.body.commandId,destinationType:req.body.destinationType,trigger:'MANUAL',actor:actorFrom(req)})));
  app.post('/backups/off-device',{preHandler:guard.requirePermission(PERMISSIONS.BACKUP_CREATE),schema:{body:ConfigureOffDeviceBackupRequestSchema,response:{200:BackupProtectionStatusSchema}}},async(req)=>manager.configureOffDevice(req.body.directoryPath,req.body.commandId,actorFrom(req)));
  app.post('/recovery-key/export',{preHandler:guard.requirePermission(PERMISSIONS.RECOVERY_EXECUTE),schema:{body:RecoveryKeyExportRequestSchema,response:{200:RecoveryKeyExportResponseSchema}}},async(req)=>manager.exportRecoveryKey(req.body.commandId,actorFrom(req)));
  if(recovery)app.post('/recovery/restore',{preHandler:guard.requirePermission(PERMISSIONS.RECOVERY_EXECUTE),schema:{body:RestoreBackupRequestSchema,response:{202:RestoreScheduledResponseSchema}}},async(req,reply)=>reply.status(202).send(await recovery.schedule({commandId:req.body.commandId,backupId:req.body.backupId,
    ...(req.body.artifactPath?{artifactPath:req.body.artifactPath}:{}),...(req.body.recoveryKey?{recoveryKey:req.body.recoveryKey}:{}),
    ...(req.body.recoveryAuthorization?{recoveryAuthorization:req.body.recoveryAuthorization}:{}),actor:actorFrom(req)})));
};}
