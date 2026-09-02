import fastify from 'fastify';
import { serializerCompiler,validatorCompiler,ZodTypeProvider } from 'fastify-type-provider-zod';
import { EmergencyRestoreRequestSchema,HealthResponseSchema,RecoveryBootstrapStatusSchema,
  RestoreScheduledResponseSchema } from '@comanview/contracts';
import type { EdgeSyncConfig } from '@comanview/config';
import { errorHandler,AppError } from '../../app/errorHandler.js';
import { scheduleEmergencyRecovery } from './RecoveryCoordinator.js';
import type { RecoverySecurityStore } from './RecoverySecurityStore.js';

export async function buildRecoveryRequiredApp(input:{dbPath:string;securityStore:RecoverySecurityStore;
  syncConfig:EdgeSyncConfig;requestRestart?:()=>void}){
  const app=fastify({logger:true}).withTypeProvider<ZodTypeProvider>();
  let scheduling=false;
  app.setValidatorCompiler(validatorCompiler);app.setSerializerCompiler(serializerCompiler);app.setErrorHandler(errorHandler);
  app.get('/health',{schema:{response:{200:HealthResponseSchema}}},async()=>({status:'DOWN' as const,
    edgeService:{status:'ERROR' as const,timestamp:new Date().toISOString()},database:{status:'ERROR' as const},
    recoveryState:'RECOVERY_REQUIRED' as const}));
  app.get('/recovery/status',{schema:{response:{200:RecoveryBootstrapStatusSchema}}},async()=>{
    const floor=await input.securityStore.load();return {recoveryState:'RECOVERY_REQUIRED' as const,
      installationEstablished:true as const,bindingAvailable:Boolean(floor.binding)};
  });
  app.post('/recovery/emergency-restore',{schema:{body:EmergencyRestoreRequestSchema,response:{202:RestoreScheduledResponseSchema}}},
    async(request,reply)=>{
      if(scheduling)throw new AppError('RECOVERY_IN_PROGRESS',409,'Recovery is already being prepared.');
      scheduling=true;try{
      const floor=await input.securityStore.load();
      if(!floor.binding)throw new AppError('RECOVERY_REQUIRED',503,'Installation binding is unavailable.');
      const result=await scheduleEmergencyRecovery({commandId:request.body.commandId,backupId:request.body.backupId,
        artifactPath:request.body.artifactPath,recoveryKey:request.body.recoveryKey,
        ...(request.body.recoveryAuthorization?{recoveryAuthorization:request.body.recoveryAuthorization}:{}),
        binding:floor.binding,publicKeyring:input.syncConfig.licensing.publicKeyring,
        securityStore:input.securityStore,dbPath:input.dbPath,now:new Date()});
      reply.status(202).send(result);setTimeout(()=>input.requestRestart?.(),50).unref();
      }finally{scheduling=false;}
    });
  return app;
}
