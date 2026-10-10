import fs from 'fs';
import { validateCallback, validateOptions } from '../lib/options.ts';
import { childPath, type FsPath, READ_BUFFER_ENTRIES, validatePath } from '../lib/path.ts';
import { getRetryDelay, isRetryableError } from '../retry.ts';
import type { RmCallback, RmOptions, RmPath } from '../types.ts';
import { createEISDIR } from './errors.ts';
import { fixWinEPERM, shouldFixEPERM } from './fixWinEPERM.ts';

type Attempt = (path: FsPath, options: Required<RmOptions>, attempt: number, callback: RmCallback) => void;

/**
 * Retry one operation on a retryable error. Retries never re-walk a directory, so the
 * wait for a stuck entry is bounded by maxRetries regardless of tree depth.
 */
function retryOrFail(path: FsPath, options: Required<RmOptions>, attempt: number, err: NodeJS.ErrnoException, callback: RmCallback, retryFn: Attempt): void {
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
function fixOrRetry(path: FsPath, options: Required<RmOptions>, attempt: number, err: NodeJS.ErrnoException, callback: RmCallback, retryFn: Attempt): void {
  if (!shouldFixEPERM(err)) return retryOrFail(path, options, attempt, err, callback, retryFn);
  fixWinEPERM(path, err, (fixErr) => {
    if (!fixErr) return callback();
    retryOrFail(path, options, attempt, err, callback, retryFn);
  });
}

function unlinkWithRetry(path: FsPath, options: Required<RmOptions>, attempt: number, callback: RmCallback): void {
  fs.unlink(path, (err) => {
    if (!err) return callback();
    if (err.code === 'ENOENT') return options.force ? callback() : callback(err);
    fixOrRetry(path, options, attempt, err, callback, unlinkWithRetry);
  });
}

function rmdirWithRetry(path: FsPath, options: Required<RmOptions>, attempt: number, callback: RmCallback): void {
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
function removeEntry(path: FsPath, options: Required<RmOptions>, attempt: number, callback: RmCallback): void {
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
function rmdirRecursive(path: FsPath, options: Required<RmOptions>, callback: RmCallback): void {
  const onRead = (readErr: NodeJS.ErrnoException | null, entries: FsPath[]) => {
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
      removeEntry(childPath(path, entries[i]), options, 0, onDone);
    }
  };
  if (READ_BUFFER_ENTRIES) fs.readdir(path, { encoding: 'buffer' }, onRead);
  else fs.readdir(path, onRead);
}

/**
 * Fallback rm implementation for Node < 14.14.
 * Backports documented removal options and paths; retries are bounded per entry.
 */
export default function fallbackRm(path: RmPath, options: RmOptions | undefined, callback: RmCallback, safeRetries = false): void {
  const target = validatePath(path);
  const opts = validateOptions(options);
  validateCallback(callback);
  if (!opts.recursive && !safeRetries) opts.maxRetries = 0;
  removeEntry(target, opts, 0, callback);
}
