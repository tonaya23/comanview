import { describe, it, expect, vi } from 'vitest';
import { runtimeState, bootTime, processStart, stopRecordedProcess, archiveRuntime } from '../acceptanceLabRuntime.js';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const boot='2026-09-20T10:00:00Z';
const runtime={startedAt:'2026-09-20T11:00:00Z',bootAt:boot,processes:{edge:123},processStarts:{edge:'100'}};
describe('acceptance lab process identity',()=>{
  it('reboot proves old runtime stale without inspecting reused PIDs',()=>{const inspect=vi.fn(()=> '100');expect(runtimeState({processes:runtime.processes,startedAt:'2026-09-19T11:00:00Z'},boot,inspect)).toBe('STALE');expect(inspect).not.toHaveBeenCalled();});
  it('never treats live legacy PID as owned',()=>{expect(runtimeState({startedAt:runtime.startedAt,processes:{edge:123}},boot,()=> '100')).toBe('AMBIGUOUS');});
  it('identifies current process by PID and creation time',()=>{expect(runtimeState(runtime,boot,()=> '100')).toBe('RUNNING');});
  it('does not claim a reused PID',()=>{expect(runtimeState(runtime,boot,()=> '200')).toBe('STALE');});
  it('detects missing processes',()=>{expect(runtimeState(runtime,boot,()=>null)).toBe('STALE');});
  it('keeps partially running lab for review',()=>{expect(runtimeState({...runtime,processes:{edge:123,pos:456},processStarts:{edge:'100',pos:'200'}},boot,pid=>pid===123?'100':null)).toBe('PARTIAL');});
  it('invalid timestamp fails closed',()=>{expect(runtimeState({...runtime,startedAt:'invalid'},boot,()=>null)).toBe('AMBIGUOUS');});
  it('archives evidence rather than deleting it',()=>{const root=mkdtempSync(join(tmpdir(),'cv-runtime-test-'));try{const path=join(root,'runtime.json');writeFileSync(path,JSON.stringify(runtime));const archived=archiveRuntime(path);expect(existsSync(path)).toBe(false);expect(JSON.parse(readFileSync(archived,'utf8'))).toEqual(runtime);}finally{rmSync(root,{recursive:true,force:true});}});
  it('requires creation identity before stopping anything',()=>{expect(()=>stopRecordedProcess(123,undefined)).toThrow('IDENTITY_REQUIRED');});
  it.runIf(process.platform==='win32')('reads real Windows metadata and leaves reused identity untouched',()=>{const started=processStart(process.pid);expect(started).toMatch(/^\d+$/);expect(Date.parse(bootTime())).toBeLessThan(Date.now());stopRecordedProcess(process.pid,'1');expect(processStart(process.pid)).toBe(started);});
});
