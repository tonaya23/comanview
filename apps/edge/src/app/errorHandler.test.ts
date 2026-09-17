import { describe,expect,it,vi } from 'vitest';
import type { FastifyReply,FastifyRequest } from 'fastify';
import type { PublicErrorDetails } from '@comanview/contracts';
import { ObjectNotFoundError } from './errors.js';
import { AppError,errorHandler,parseContractErrorCode } from './errorHandler.js';

function handle(error:Error,id='req-42'){
  let status:number|undefined,body:unknown;
  const reply={status:vi.fn((value:number)=>{status=value;return reply;}),
    send:vi.fn((value:unknown)=>{body=value;return reply;})};
  const log={error:vi.fn()};
  errorHandler(error,{id,log} as unknown as FastifyRequest,reply as unknown as FastifyReply);
  return{status,body,log};
}

describe('Edge public error boundary',()=>{
  it('makes AppError code a compile-time contractual boundary',()=>{
    type AppErrorCode=ConstructorParameters<typeof AppError>[0];
    const invalidCodeIsRejected:'NOT_A_CONTRACT_CODE' extends AppErrorCode?false:true=true;
    expect(invalidCodeIsRejected).toBe(true);
    expect(parseContractErrorCode('NOT_A_CONTRACT_CODE')).toBeNull();
  });

  it('preserves a known code, status and allowlisted public details',()=>{
    const result=handle(new AppError('TABLE_OCCUPIED',409,'occupied',{tableId:'table-1',activeOrderId:'order-1'}));
    expect(result.status).toBe(409);
    expect(result.body).toEqual({error:'TABLE_OCCUPIED',message:'occupied',details:{
      tableId:'table-1',activeOrderId:'order-1',diagnosticId:'req-42'}});
  });

  it('maps derived tax and generic not-found errors to contractual codes',()=>{
    expect(handle(new Error('TAX_SNAPSHOT_MISSING')).body).toMatchObject({error:'TAX_SNAPSHOT_MISSING'});
    const missing=handle(new ObjectNotFoundError('Entity was not found.'));
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({error:'NOT_FOUND'});
  });

  it('publishes only validation paths/messages and never Fastify params or submitted values',()=>{
    const validationError=Object.assign(new Error('invalid request'),{statusCode:400,code:'FST_ERR_VALIDATION',
      validation:[{instancePath:'/pin',message:'must have 4 digits',keyword:'pattern',
        params:{pattern:'secret-pattern'},data:'1234'}]});
    expect(handle(validationError).body).toEqual({error:'VALIDATION_ERROR',message:'Request validation failed.',details:{
      validationIssues:[{path:'/pin',message:'Invalid value.',keyword:'pattern'}],diagnosticId:'req-42'}});
  });

  it('drops non-allowlisted details and fails unknown errors closed',()=>{
    const unsafe={token:'secret-token',stack:'private-stack',path:'C:\\private\\edge.db'} as unknown as PublicErrorDetails;
    const known=handle(new AppError('DOMAIN_CONFLICT',409,'conflict',unsafe));
    expect(known.body).toEqual({error:'DOMAIN_CONFLICT',message:'conflict',details:{diagnosticId:'req-42'}});
    expect(JSON.stringify(known.body)).not.toContain('secret-token');

    const unknown=handle(new Error('private filesystem C:\\private\\edge.db token=secret'));
    expect(unknown.status).toBe(500);
    expect(unknown.body).toEqual({error:'INTERNAL_ERROR',message:'An unexpected error occurred',details:{diagnosticId:'req-42'}});
    expect(JSON.stringify(unknown.body)).not.toContain('private');
    expect(unknown.log.error).toHaveBeenCalledOnce();
  });
});
