import fs from 'fs';
import { fixWinEPERM, shouldFixEPERM } from './fallback/fixWinEPERM.ts';
import fallbackRm from './fallback/rm.ts';
import { getBackoffDelay, isRetryableError, SAFE_DEFAULTS } from './retry.ts';
import type { RmCallback, RmOptions } from './types.ts';

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
function safeRm(path: string, optionsOrCallback: RmOptions | RmCallback, maybeCallback?: RmCallback): void {
  // Parse arguments
  if (typeof optionsOrCallback === 'function') {
    safeRmImpl(path, undefined, 0, optionsOrCallback);
  } else {
    safeRmImpl(path, optionsOrCallback, 0, maybeCallback as RmCallback);
  }
}

/**
 * Callback-based implementation with retry.
 */
function safeRmImpl(path: string, options: RmOptions | undefined, attempt: number, callback: RmCallback) {
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
function retryIfNeeded(path: string, options: RmOptions | undefined, attempt: number, err: NodeJS.ErrnoException, callback: RmCallback) {
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
function rmOnce(path: string, options: RmOptions, callback: RmCallback) {
  if (HAS_NATIVE_RM) {
    (fs as typeof fs & { rm: (path: string, options: RmOptions, callback: RmCallback) => void }).rm(path, options, callback);
  } else {
    fallbackRm(path, options, callback);
  }
}

export default safeRm;
