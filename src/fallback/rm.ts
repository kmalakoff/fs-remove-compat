import fs from 'fs';
import { join } from 'path';
import { getRetryDelay, isRetryableError } from '../retry.ts';
import type { RmCallback, RmOptions } from '../types.ts';
import { createEISDIR } from './errors.ts';
import { fixWinEPERM, shouldFixEPERM } from './fixWinEPERM.ts';

type Attempt = (path: string, options: Required<RmOptions>, attempt: number, callback: RmCallback) => void;

/**
 * Retry one operation on a retryable error. Retries never re-walk a directory, so the
 * wait for a stuck entry is bounded by maxRetries regardless of tree depth.
 */
function retryOrFail(path: string, options: Required<RmOptions>, attempt: number, err: NodeJS.ErrnoException, callback: RmCallback, retryFn: Attempt): void {
  if (!isRetryableError(err) || attempt >= options.maxRetries) {
    callback(err);
    return;
  }
  setTimeout(
    () => {
      retryFn(path, options, attempt + 1, callback);
    },
    getRetryDelay(options.retryDelay, attempt)
  );
}

/**
 * On Windows EPERM, clear the read-only bit and remove once before backing off.
 */
function fixOrRetry(path: string, options: Required<RmOptions>, attempt: number, err: NodeJS.ErrnoException, callback: RmCallback, retryFn: Attempt): void {
  if (!shouldFixEPERM(err)) return retryOrFail(path, options, attempt, err, callback, retryFn);
  fixWinEPERM(path, err, (fixErr) => {
    if (!fixErr) return callback();
    retryOrFail(path, options, attempt, err, callback, retryFn);
  });
}

function unlinkWithRetry(path: string, options: Required<RmOptions>, attempt: number, callback: RmCallback): void {
  fs.unlink(path, (err) => {
    if (!err) return callback();
    if (err.code === 'ENOENT') return options.force ? callback() : callback(err);
    fixOrRetry(path, options, attempt, err, callback, unlinkWithRetry);
  });
}

function rmdirWithRetry(path: string, options: Required<RmOptions>, attempt: number, callback: RmCallback): void {
  fs.rmdir(path, (err) => {
    if (!err) return callback();
    if (err.code === 'ENOENT') return options.force ? callback() : callback(err);
    fixOrRetry(path, options, attempt, err, callback, rmdirWithRetry);
  });
}

/**
 * Remove one entry. lstat gets the same retry as unlink: Windows reports a file whose
 * delete is pending as EPERM until the last handle on it closes.
 */
function removeEntry(path: string, options: Required<RmOptions>, attempt: number, callback: RmCallback): void {
  fs.lstat(path, (statErr, stats) => {
    if (statErr) {
      if (statErr.code === 'ENOENT') return options.force ? callback() : callback(statErr);
      return fixOrRetry(path, options, attempt, statErr, callback, removeEntry);
    }
    if (!stats.isDirectory()) return unlinkWithRetry(path, options, 0, callback);
    if (!options.recursive) return callback(createEISDIR(path));
    rmdirRecursive(path, options, callback);
  });
}

/**
 * Remove a directory's entries in parallel, then the directory. An error is reported only
 * after every in-flight entry has finished, so nothing keeps deleting after the callback.
 */
function rmdirRecursive(path: string, options: Required<RmOptions>, callback: RmCallback): void {
  fs.readdir(path, (readErr, entries) => {
    if (readErr) {
      if (readErr.code === 'ENOENT' && options.force) return callback();
      return callback(readErr);
    }

    let pending = entries.length;
    if (pending === 0) return rmdirWithRetry(path, options, 0, callback);

    let firstErr: NodeJS.ErrnoException | null = null;
    const onDone = (err?: NodeJS.ErrnoException | null) => {
      if (err && !firstErr) firstErr = err;
      if (--pending > 0) return;
      if (firstErr) return callback(firstErr);
      rmdirWithRetry(path, options, 0, callback);
    };

    for (let i = 0; i < entries.length; i++) {
      removeEntry(join(path, entries[i]), options, 0, onDone);
    }
  });
}

/**
 * Fallback rm implementation for Node < 14.14.
 * Matches Node.js fs.rm API.
 */
export default function fallbackRm(path: string, options: RmOptions | undefined, callback: RmCallback): void {
  const opts: Required<RmOptions> = {
    recursive: options?.recursive ?? false,
    force: options?.force ?? false,
    maxRetries: options?.maxRetries ?? 0,
    retryDelay: options?.retryDelay ?? 100,
  };
  removeEntry(path, opts, 0, callback);
}
