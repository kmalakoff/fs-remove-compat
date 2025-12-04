import fs from 'fs';
import Pinkie from 'pinkie-promise';
import { fixWinEPERM, shouldFixEPERM } from './fallback/fixWinEPERM.js';
import fallbackRm from './fallback/rm.js';
import { getBackoffDelay, isRetryableError, SAFE_DEFAULTS, sleep } from './retry.js';
import type { RmCallback, RmOptions } from './types.js';

/**
 * Check if native fs.rm is available.
 */
const HAS_NATIVE_RM = typeof (fs as typeof fs & { rm?: unknown }).rm === 'function';

/**
 * Remove a file or directory asynchronously with Windows-friendly defaults.
 *
 * This is NOT a strict ponyfill - it provides enhanced behavior:
 * - Default maxRetries: 10 on Windows, 0 on POSIX
 * - Exponential backoff (1.2 factor) instead of linear
 * - EPERM chmod fix before retry on Windows
 *
 * Use this for CI/test cleanup where Windows file locking is common.
 * For strict Node.js fs.rm compatibility, use rm instead.
 */
function safeRm(path: string, callback: RmCallback): void;
function safeRm(path: string, options: RmOptions, callback: RmCallback): void;
function safeRm(path: string, options?: RmOptions): Promise<void>;
function safeRm(path: string, optionsOrCallback?: RmOptions | RmCallback, maybeCallback?: RmCallback): void | Promise<void> {
  // Parse arguments
  let options: RmOptions | undefined;
  let callback: RmCallback | undefined;

  if (typeof optionsOrCallback === 'function') {
    callback = optionsOrCallback;
  } else {
    options = optionsOrCallback;
    callback = maybeCallback;
  }

  // Promise style
  if (typeof callback !== 'function') {
    return safeRmPromise(path, options);
  }

  // Callback style
  safeRmImpl(path, options, 0, callback);
}

/**
 * Promise-based implementation with retry.
 */
async function safeRmPromise(path: string, options?: RmOptions): Promise<void> {
  const opts = {
    recursive: options?.recursive ?? SAFE_DEFAULTS.recursive,
    force: options?.force ?? SAFE_DEFAULTS.force,
    maxRetries: options?.maxRetries ?? SAFE_DEFAULTS.maxRetries,
    retryDelay: options?.retryDelay ?? SAFE_DEFAULTS.retryDelay,
  };

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      await new Pinkie<void>((resolve, reject) => {
        rmOnce(path, { ...opts, maxRetries: 0 }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      return; // Success
    } catch (err) {
      // Handle ENOENT with force
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' && opts.force) {
        return;
      }

      // Try EPERM fix on Windows
      if (shouldFixEPERM(err as NodeJS.ErrnoException)) {
        try {
          await new Pinkie<void>((resolve, reject) => {
            fixWinEPERM(path, err as NodeJS.ErrnoException, (fixErr) => {
              if (fixErr) reject(fixErr);
              else resolve();
            });
          });
          return; // Success after chmod fix
        } catch (_fixErr) {
          // Fall through to retry
        }
      }

      // Check if we should retry
      if (!isRetryableError(err) || attempt >= opts.maxRetries) {
        throw err;
      }

      // Exponential backoff
      const delay = getBackoffDelay(opts.retryDelay, attempt);
      await sleep(delay);
    }
  }
}

/**
 * Callback-based implementation with retry.
 */
function safeRmImpl(path: string, options: RmOptions | undefined, attempt: number, callback: RmCallback): void {
  const opts = {
    recursive: options?.recursive ?? SAFE_DEFAULTS.recursive,
    force: options?.force ?? SAFE_DEFAULTS.force,
    maxRetries: options?.maxRetries ?? SAFE_DEFAULTS.maxRetries,
    retryDelay: options?.retryDelay ?? SAFE_DEFAULTS.retryDelay,
  };

  rmOnce(path, { ...opts, maxRetries: 0 }, (err) => {
    if (!err) return callback();

    // Handle ENOENT with force
    if (err.code === 'ENOENT' && opts.force) {
      return callback();
    }

    // Try EPERM fix on Windows
    if (shouldFixEPERM(err)) {
      return fixWinEPERM(path, err, (fixErr) => {
        if (!fixErr) return callback();
        // Fall through to retry
        retryIfNeeded(path, options, attempt, err, callback);
      });
    }

    retryIfNeeded(path, options, attempt, err, callback);
  });
}

/**
 * Retry helper for callback style.
 */
function retryIfNeeded(path: string, options: RmOptions | undefined, attempt: number, err: NodeJS.ErrnoException, callback: RmCallback): void {
  const maxRetries = options?.maxRetries ?? SAFE_DEFAULTS.maxRetries;
  const retryDelay = options?.retryDelay ?? SAFE_DEFAULTS.retryDelay;

  if (!isRetryableError(err) || attempt >= maxRetries) {
    callback(err);
    return;
  }

  const delay = getBackoffDelay(retryDelay, attempt);
  setTimeout(() => {
    safeRmImpl(path, options, attempt + 1, callback);
  }, delay);
}

/**
 * Single rm attempt (no retry).
 */
function rmOnce(path: string, options: RmOptions, callback: RmCallback): void {
  if (HAS_NATIVE_RM) {
    (fs as typeof fs & { rm: (path: string, options: RmOptions, callback: RmCallback) => void }).rm(path, options, callback);
  } else {
    fallbackRm(path, options, callback);
  }
}

export default safeRm;
