/** QA process bookkeeping only. No installation/security state is read or written. */
import { spawnSync } from 'node:child_process';
import { renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export type LabRuntime = {
  processes: Record<string, number>;
  startedAt: string;
  bootAt?: string;
  processStarts?: Record<string, string>;
};
function powershell(script: string): string {
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('ACCEPTANCE_LAB_PROCESS_INSPECTION_FAILED');
  return result.stdout.trim();
}
export function bootTime(): string {
  const value = powershell("(Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime.ToUniversalTime().ToString('o')");
  if (!Number.isFinite(Date.parse(value))) throw new Error('ACCEPTANCE_LAB_BOOT_TIME_INVALID');
  return value;
}
export function processStart(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('ACCEPTANCE_LAB_RUNTIME_INVALID');
  const value = powershell(`$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){try{$p.StartTime.ToUniversalTime().Ticks.ToString()}catch{exit 1}}`);
  if (value && !/^\d+$/.test(value)) throw new Error('ACCEPTANCE_LAB_PROCESS_INSPECTION_FAILED');
  return value || null;
}
export function runtimeState(runtime: LabRuntime, boot: string, inspect = processStart): 'STALE' | 'RUNNING' | 'PARTIAL' | 'AMBIGUOUS' {
  const started = Date.parse(runtime.startedAt), bootMs = Date.parse(boot);
  if (!Number.isFinite(started) || !Number.isFinite(bootMs) || !runtime.processes || !Object.keys(runtime.processes).length)
    return 'AMBIGUOUS';
  // Proof of reboot takes precedence over PID existence: Windows may have reused every PID.
  if (started < bootMs && (!runtime.bootAt || Date.parse(runtime.bootAt) < bootMs)) return 'STALE';
  if (runtime.bootAt && Date.parse(runtime.bootAt) !== bootMs) return 'AMBIGUOUS';
  let alive = 0;
  for (const [name, pid] of Object.entries(runtime.processes)) {
    const actual = inspect(pid), expected = runtime.processStarts?.[name];
    if (actual && !expected) return 'AMBIGUOUS'; // Legacy PID alone is never authority to terminate.
    if (actual && actual === expected) alive++;
  }
  return alive === Object.keys(runtime.processes).length ? 'RUNNING' : alive ? 'PARTIAL' : 'STALE';
}
export function archiveRuntime(path: string): string {
  const archived = `${path}.previous-${randomUUID()}`;
  renameSync(path, archived);
  return archived;
}
export function stopRecordedProcess(pid: number, expected: string | undefined): void {
  if (!expected || !/^\d+$/.test(expected) || !Number.isSafeInteger(pid) || pid <= 0)
    throw new Error('ACCEPTANCE_LAB_PROCESS_IDENTITY_REQUIRED');
  // Keep the Process handle after checking StartTime, rather than taskkill a potentially reused PID.
  powershell(`$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){try{if($p.StartTime.ToUniversalTime().Ticks.ToString() -eq '${expected}'){$p.Kill();$p.WaitForExit()}}catch{exit 1}finally{$p.Dispose()}}`);
}
