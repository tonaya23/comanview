import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';

export interface StoredEdgeCredential {
  credentialId: string;
  credential: string;
  rotationId?: string;
}
export interface StoredEdgeSecrets {
  active: StoredEdgeCredential | null;
  pending: StoredEdgeCredential | null;
}
export interface EdgeSecretStore {
  load(): Promise<StoredEdgeSecrets>;
  save(value: StoredEdgeSecrets): Promise<void>;
  hasPersistedState(): Promise<boolean>;
}

abstract class FileSecretStore implements EdgeSecretStore {
  constructor(protected readonly path: string) {}
  async hasPersistedState():Promise<boolean>{
    return stat(this.path).then(value=>value.isFile()).catch((error:NodeJS.ErrnoException)=>{
      if(error.code==='ENOENT')return false;throw error;
    });
  }
  async load(): Promise<StoredEdgeSecrets> {
    try { return validate(JSON.parse((await this.decode(await readFile(this.path))).toString('utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { active: null, pending: null };
      throw error;
    }
  }
  async save(value: StoredEdgeSecrets): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, await this.encode(Buffer.from(JSON.stringify(validate(value)), 'utf8')), { mode: 0o600 });
    await rename(temporary, this.path);
    await this.protectFile();
    await unlink(temporary).catch(() => undefined);
  }
  protected abstract encode(value: Buffer): Promise<Buffer>;
  protected abstract decode(value: Buffer): Promise<Buffer>;
  protected async protectFile(): Promise<void> {}
}

/** Explicitly non-production adapter. The file contains the credential in plaintext. */
export class DevelopmentFileEdgeSecretStore extends FileSecretStore {
  protected async encode(value: Buffer) { return value; }
  protected async decode(value: Buffer) { return value; }
}

/** Windows production adapter: DPAPI CurrentUser binds decryption to the service identity. */
export class WindowsDpapiEdgeSecretStore extends FileSecretStore {
  constructor(path: string) {
    super(path);
    if (process.platform !== 'win32') throw new Error('Windows DPAPI secret storage requires Windows.');
  }
  protected encode(value: Buffer) { return invokeDpapi('Protect', value); }
  protected decode(value: Buffer) { return invokeDpapi('Unprotect', value); }
  protected override async protectFile(): Promise<void> {
    const script = `$p=[Console]::In.ReadToEnd();$id=[System.Security.Principal.WindowsIdentity]::GetCurrent();` +
      `$acl=New-Object System.Security.AccessControl.FileSecurity;` +
      `$acl.SetOwner($id.User);$acl.SetAccessRuleProtection($true,$false);` +
      `$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($id.User,'FullControl','Allow');` +
      `$acl.AddAccessRule($rule);[System.IO.File]::SetAccessControl($p,$acl)`;
    await execPowerShell(script, [], Buffer.from(this.path, 'utf8'));
  }
}

export function createEdgeSecretStore(environment: NodeJS.ProcessEnv = process.env): EdgeSecretStore {
  const mode = environment['COMANVIEW_EDGE_SECRET_STORE'] ??
    (environment['NODE_ENV'] === 'production' ? 'windows-dpapi' : 'development-file');
  const path = environment['COMANVIEW_EDGE_SECRET_PATH']?.trim() || '.comanview/edge-credentials.bin';
  if (environment['NODE_ENV'] === 'production' && mode !== 'windows-dpapi') {
    throw new Error('Production Edge credentials require COMANVIEW_EDGE_SECRET_STORE=windows-dpapi.');
  }
  if (mode === 'development-file') return new DevelopmentFileEdgeSecretStore(path);
  if (mode === 'windows-dpapi') return new WindowsDpapiEdgeSecretStore(path);
  throw new Error('Unsupported COMANVIEW_EDGE_SECRET_STORE.');
}

function validate(value: unknown): StoredEdgeSecrets {
  const record = value as Partial<StoredEdgeSecrets> | null;
  return { active: validateCredential(record?.active), pending: validateCredential(record?.pending) };
}
function validateCredential(value: unknown): StoredEdgeCredential | null {
  if (value === null || value === undefined) return null;
  const candidate = value as Partial<StoredEdgeCredential>;
  if (typeof candidate.credentialId !== 'string' || typeof candidate.credential !== 'string' || candidate.credential.length < 32) {
    throw new Error('Stored Edge credential has an invalid format.');
  }
  return { credentialId: candidate.credentialId, credential: candidate.credential,
    ...(typeof candidate.rotationId === 'string' ? { rotationId: candidate.rotationId } : {}) };
}
async function invokeDpapi(operation: 'Protect' | 'Unprotect', input: Buffer): Promise<Buffer> {
  const script = `Add-Type -AssemblyName System.Security;` +
    `$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());` +
    `$o=[Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);` +
    `[Console]::Out.Write([Convert]::ToBase64String($o))`;
  const output = await execPowerShell(script, [], Buffer.from(input.toString('base64'), 'utf8'));
  return Buffer.from(output.toString('utf8').trim(), 'base64');
}
function execPowerShell(script: string, args: string[], stdin: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script, ...args],
      { encoding: 'buffer', windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.end(stdin);
  });
}
