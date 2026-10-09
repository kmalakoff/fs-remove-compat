import fs from 'fs';
import { validateOptions } from '../lib/options.ts';
import { childPath, type FsPath, HAS_BUFFER_PATHS, validatePath } from '../lib/path.ts';
import { busyWait, getRetryDelay, isRetryableError } from '../retry.ts';
import type { RmOptions, RmPath } from '../types.ts';
import { createEISDIR } from './errors.ts';
import { fixWinEPERMSync, shouldFixEPERM } from './fixWinEPERM.ts';

/**
 * Run one operation with retries. Returns undefined when the entry is gone (ENOENT with force,
 * or removed by the Windows EPERM fix). Retries never re-walk a directory.
 */
function retrySync<T>(path: FsPath, options: Required<RmOptions>, op: () => T): T | undefined {
  for (let attempt = 0; ; attempt++) {
    try {
      return op();
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        if (options.force) return undefined;
        throw error;
      }
      if (shouldFixEPERM(error)) {
        try {
          fixWinEPERMSync(path, error);
          return undefined;
        } catch (_fixErr) {
          // The fix rethrows the original error when it cannot help; back off and retry below.
        }
      }
      if (!isRetryableError(error) || attempt >= options.maxRetries) throw error;
      busyWait(getRetryDelay(options.retryDelay, attempt));
    }
  }
}

/**
 * Remove one entry. lstat gets the same retry as unlink: Windows reports a file whose
 * delete is pending as EPERM until the last handle on it closes.
 */
function removeEntrySync(path: FsPath, options: Required<RmOptions>): void {
  const stats = retrySync(path, options, () => fs.lstatSync(path));
  if (!stats) return;
  if (!stats.isDirectory()) {
    retrySync(path, options, () => fs.unlinkSync(path));
    return;
  }
  if (!options.recursive) throw createEISDIR(path);
  rmdirRecursiveSync(path, options);
}

function rmdirRecursiveSync(path: FsPath, options: Required<RmOptions>): void {
  let entries: FsPath[];
  try {
    entries = HAS_BUFFER_PATHS ? fs.readdirSync(path, { encoding: 'buffer' }) : fs.readdirSync(path);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT' && options.force) return;
    throw error;
  }

  for (let i = 0; i < entries.length; i++) {
    removeEntrySync(childPath(path, entries[i]), options);
  }
  retrySync(path, options, () => fs.rmdirSync(path));
}

/**
 * Fallback rmSync implementation for Node < 14.14.
 * Backports documented removal options and paths; retries are bounded per entry.
 */
export default function fallbackRmSync(path: RmPath, options?: RmOptions, safeRetries = false): void {
  const target = validatePath(path);
  const opts = validateOptions(options);
  if (!opts.recursive && !safeRetries) opts.maxRetries = 0;
  removeEntrySync(target, opts);
}
