import Fastify from 'fastify';
import { serializerCompiler,validatorCompiler } from 'fastify-type-provider-zod';
import { it,expect,vi } from 'vitest';
import { AuthGuard } from '../auth/http/AuthGuard.js';
import type { AuthService } from '../auth/application/AuthService.js';
import type { PersonnelService } from './PersonnelService.js';
import type { AdministrationService } from '../administration/AdministrationService.js';
import { personnelRoutes } from './routes.js';
import { administrationRoutes } from '../administration/routes.js';
import { errorHandler } from '../../app/errorHandler.js';

it('serves authorized Personnel independently and keeps unrelated routes forbidden',async()=>{
  const app=Fastify({logger:false});
  app.setValidatorCompiler(validatorCompiler);app.setSerializerCompiler(serializerCompiler);app.setErrorHandler(errorHandler);
  const guard=new AuthGuard({authenticate:()=>({permissions:['PERSONNEL_VIEW']})} as unknown as AuthService,'enforced');
  const list=vi.fn(()=>({ownerRecoveryRequired:false,users:[]}));
  const state=vi.fn();
  await app.register(personnelRoutes({list} as unknown as PersonnelService,guard));
  await app.register(administrationRoutes({state} as unknown as AdministrationService,guard));
  try{
    const headers={authorization:'Bearer fixture-session'};
    expect((await app.inject({method:'GET',url:'/administration/personnel',headers})).statusCode).toBe(200);
    expect((await app.inject({method:'GET',url:'/administration',headers})).statusCode).toBe(403);
    expect((await app.inject({method:'GET',url:'/business-profile/public',headers})).statusCode).toBe(403);
    expect(state).not.toHaveBeenCalled();expect(list).toHaveBeenCalledOnce();
    expect((await app.inject({method:'GET',url:'/administration/personnel'})).statusCode).toBe(401);
  }finally{await app.close();}
});
