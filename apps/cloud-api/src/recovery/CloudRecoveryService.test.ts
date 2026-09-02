import { generateKeyPairSync } from 'node:crypto';import { describe,expect,it,vi } from 'vitest';
import { verifyRecoveryAuthorization } from '@comanview/licensing';
import { CloudRecoveryService } from './CloudRecoveryService.js';

describe('CloudRecoveryService',()=>{it('issues a short-lived authorization bound to source, target, location and backup',async()=>{
  const pair=generateKeyPairSync('ed25519'),privateKeyPem=pair.privateKey.export({format:'pem',type:'pkcs8'}).toString(),
    publicKey=pair.publicKey.export({format:'pem',type:'spki'}).toString();
  const repository={nextEpoch:vi.fn().mockResolvedValue(3),binding:vi.fn().mockResolvedValue({tenantId:'01991a00-0000-7000-8000-000000000201',locationId:'01991a00-0000-7000-8000-000000000202'}),
    issue:vi.fn(async(input:any)=>({authorizationId:input.authorizationId,status:'ISSUED',expiresAt:input.expiresAt,envelope:input.envelope}))};
  const service=new CloudRecoveryService(repository as any,{signingKid:'recovery-current',privateKeyPem},()=>new Date('2026-09-01T00:00:00.000Z'));
  const result=await service.issue({locationId:'01991a00-0000-7000-8000-000000000202',commandId:'01991a00-0000-7000-8000-000000000203',
    sourceEdgeId:'01991a00-0000-7000-8000-000000000204',targetEdgeId:'01991a00-0000-7000-8000-000000000205',
    backupId:'01991a00-0000-7000-8000-000000000206',reason:'Hardware replacement recovery'},
    {userId:'01991a00-0000-7000-8000-000000000207',sessionId:'01991a00-0000-7000-8000-000000000208'});
  const verified=verifyRecoveryAuthorization(result.authorization,{'recovery-current':publicKey});
  expect(verified.payload).toMatchObject({recoveryEpoch:3,sourceEdgeId:'01991a00-0000-7000-8000-000000000204',
    targetEdgeId:'01991a00-0000-7000-8000-000000000205',backupId:'01991a00-0000-7000-8000-000000000206'});
  expect(verified.payload.expiresAt).toBe('2026-09-01T00:30:00.000Z');
});});
