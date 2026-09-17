import { describe,expect,it } from 'vitest';
import { ErrorCode,ErrorResponseSchema,PublicErrorDetailsSchema } from './errors.js';

describe('public error contracts',()=>{
  it('parses every declared contractual error code',()=>{
    for(const code of ErrorCode.options)expect(ErrorCode.parse(code)).toBe(code);
  });

  it('accepts only the explicit public details allowlist',()=>{
    expect(PublicErrorDetailsSchema.parse({diagnosticId:'req-42',tableId:'table-1',
      activeOrderId:'order-1',mode:'VALID',capability:'POS',reasonCode:'ACTIVE'}))
      .toEqual({diagnosticId:'req-42',tableId:'table-1',activeOrderId:'order-1',
        mode:'VALID',capability:'POS',reasonCode:'ACTIVE'});
    for(const details of [
      {token:'secret-token'},
      {pin:'1234'},
      {pinHash:'hash'},
      {recoveryKey:'secret'},
      {path:'C:\\private\\edge.db'},
      {error:new Error('private')},
      {nested:{credential:'secret'}},
    ])expect(PublicErrorDetailsSchema.safeParse(details).success).toBe(false);
  });

  it('rejects arbitrary details and extra response properties',()=>{
    expect(ErrorResponseSchema.safeParse({error:'TABLE_OCCUPIED',message:'occupied',
      details:{tableId:'table-1',credential:'secret'}}).success).toBe(false);
    expect(ErrorResponseSchema.safeParse({error:'TABLE_OCCUPIED',message:'occupied',rawBody:{}}).success).toBe(false);
  });
});
