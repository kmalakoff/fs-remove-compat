import { type ChildProcess, spawn } from 'child_process';
import fs from 'fs';

export interface FileLock {
  release: (delay?: number) => void;
  close: (callback: (error?: Error) => void) => void;
}

/** Real exclusive Windows handle; the windows-latest CI job owns this fixture. */
export function lockFile(file: string, releaseFile: string, callback: (error: Error | null, lock?: FileLock) => void): void {
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const script = `$ErrorActionPreference='Stop'; $handle=[IO.File]::Open(${quote(file)}, 'Open', 'ReadWrite', 'None');
try { [Console]::WriteLine('READY'); $watch=[Diagnostics.Stopwatch]::StartNew();
while (!(Test-Path -LiteralPath ${quote(releaseFile)})) { if ($watch.Elapsed.TotalSeconds -gt 60) { throw 'Lock release was not signaled' }; Start-Sleep -Milliseconds 20 }
$delay=[int](Get-Content -LiteralPath ${quote(releaseFile)}); if ($delay -gt 0) { Start-Sleep -Milliseconds $delay }
} finally { $handle.Dispose() }`;
  const encoded = (typeof Buffer.from === 'function' ? Buffer.from(script, 'utf16le') : new Buffer(script, 'utf16le')).toString('base64');
  const child: ChildProcess = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]);
  let ready = false;
  let exited = false;
  let output = '';
  let stderr = '';
  let outcome: Error | undefined;
  const waiters: ((error?: Error) => void)[] = [];
  const release = (delay = 0) => {
    if (!exited) fs.writeFileSync(releaseFile, String(delay));
  };
  const lock: FileLock = {
    release,
    close: (done) => {
      if (exited) return done(outcome);
      waiters.push(done);
      release();
    },
  };
  child.stdout?.on('data', (data: Buffer) => {
    output += data.toString();
    if (!ready && output.indexOf('READY') !== -1) {
      ready = true;
      callback(null, lock);
    }
  });
  child.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString();
  });
  child.on('error', (error) => {
    outcome = error;
  });
  child.on('close', (code) => {
    exited = true;
    if (code !== 0 && !outcome) outcome = new Error(`Windows lock fixture failed (${code}): ${stderr}`);
    if (!ready) callback(outcome || new Error('Windows lock fixture never acquired the exclusive handle'));
    waiters.forEach((done) => done(outcome));
  });
}

export function closeLocks(locks: FileLock[], done: (error?: Error) => void): void {
  let pending = locks.length;
  let firstError: Error | undefined;
  if (!pending) return done();
  locks.splice(0).forEach((lock) =>
    lock.close((error) => {
      if (error && !firstError) firstError = error;
      if (--pending === 0) done(firstError);
    })
  );
}
