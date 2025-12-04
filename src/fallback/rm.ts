import fs from 'fs';
import type { RmCallback, RmOptions } from '../types.ts';
import { fixWinEPERM, shouldFixEPERM } from './fixWinEPERM.ts';

const RETRYABLE_CODES = ['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM'];

/**
 * Remove a file asynchronously with retry logic.
 */
function unlinkWithRetry(path: string, options: Required<RmOptions>, attempt: number, callback: RmCallback): void {
  fs.unlink(path, (err) => {
    if (!err) return callback();

    // Handle ENOENT
    if (err.code === 'ENOENT') {
      if (options.force) return callback();
      return callback(err);
    }

    // Try EPERM fix on Windows
    if (shouldFixEPERM(err)) {
      return fixWinEPERM(path, err, (fixErr) => {
        if (!fixErr) return callback();
        // Fall through to retry logic
        retryOrFail(path, options, attempt, err, callback, unlinkWithRetry);
      });
    }

    retryOrFail(path, options, attempt, err, callback, unlinkWithRetry);
  });
}

/**
 * Remove a directory asynchronously with retry logic.
 */
function rmdirWithRetry(path: string, options: Required<RmOptions>, attempt: number, callback: RmCallback): void {
  fs.rmdir(path, (err) => {
    if (!err) return callback();

    if (err.code === 'ENOENT') {
      if (options.force) return callback();
      return callback(err);
    }

    retryOrFail(path, options, attempt, err, callback, rmdirWithRetry);
  });
}

/**
 * Retry logic helper.
 */
function retryOrFail(path: string, options: Required<RmOptions>, attempt: number, err: NodeJS.ErrnoException, callback: RmCallback, retryFn: (path: string, options: Required<RmOptions>, attempt: number, callback: RmCallback) => void): void {
  if (RETRYABLE_CODES.indexOf(err.code || '') === -1 || attempt >= options.maxRetries) {
    callback(err);
    return;
  }

  setTimeout(() => {
    retryFn(path, options, attempt + 1, callback);
  }, options.retryDelay);
}

/**
 * Remove directory contents recursively.
 */
function rmdirRecursive(path: string, options: Required<RmOptions>, callback: RmCallback): void {
  fs.readdir(path, (readErr, entries) => {
    if (readErr) {
      if (readErr.code === 'ENOENT' && options.force) return callback();
      return callback(readErr);
    }

    let pending = entries.length;
    if (pending === 0) {
      return rmdirWithRetry(path, options, 0, callback);
    }

    let hasError = false;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const entryPath = `${path}/${entry}`;

      fs.lstat(entryPath, (statErr, stats) => {
        if (hasError) return;

        if (statErr) {
          if (statErr.code === 'ENOENT' && options.force) {
            pending--;
            if (pending === 0) rmdirWithRetry(path, options, 0, callback);
            return;
          }
          hasError = true;
          return callback(statErr);
        }

        const onDone = (err?: NodeJS.ErrnoException | null) => {
          if (hasError) return;
          if (err) {
            hasError = true;
            return callback(err);
          }
          pending--;
          if (pending === 0) {
            rmdirWithRetry(path, options, 0, callback);
          }
        };

        if (stats.isDirectory()) {
          rmdirRecursive(entryPath, options, onDone);
        } else {
          unlinkWithRetry(entryPath, options, 0, onDone);
        }
      });
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

  fs.lstat(path, (statErr, stats) => {
    if (statErr) {
      if (statErr.code === 'ENOENT') {
        if (opts.force) return callback();
        return callback(statErr);
      }
      return callback(statErr);
    }

    if (stats.isDirectory()) {
      if (!opts.recursive) {
        const err = new Error(`EISDIR: illegal operation on a directory, rm '${path}'`) as NodeJS.ErrnoException;
        err.code = 'EISDIR';
        err.syscall = 'rm';
        err.path = path;
        return callback(err);
      }
      rmdirRecursive(path, opts, callback);
    } else {
      unlinkWithRetry(path, opts, 0, callback);
    }
  });
}
