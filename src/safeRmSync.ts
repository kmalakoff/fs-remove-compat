import fs from 'fs';
import { fixWinEPERMSync, shouldFixEPERM } from './fallback/fixWinEPERM.js';
import fallbackRmSync from './fallback/rmSync.js';
import { busyWait, getBackoffDelay, isRetryableError, SAFE_DEFAULTS } from './retry.js';
import type { RmOptions } from './types.js';

/**
 * Check if native fs.rmSync is available.
 */
const HAS_NATIVE_RM_SYNC = typeof (fs as typeof fs & { rmSync?: unknown }).rmSync === 'function';

/**
 * Remove a file or directory synchronously with Windows-friendly defaults.
 *
 * This is NOT a strict ponyfill - it provides enhanced behavior:
 * - Default maxRetries: 10 on Windows, 0 on POSIX
 * - Exponential backoff (1.2 factor) instead of linear
 * - EPERM chmod fix before retry on Windows
 *
 * Use this for CI/test cleanup where Windows file locking is common.
 * For strict Node.js fs.rmSync compatibility, use rmSync instead.
 *
 * @param path - Path to remove
 * @param options - Options (with Windows-friendly defaults)
 */
function safeRmSync(path: string, options?: RmOptions): void {
  const opts = {
    recursive: options?.recursive ?? SAFE_DEFAULTS.recursive,
    force: options?.force ?? SAFE_DEFAULTS.force,
    maxRetries: options?.maxRetries ?? SAFE_DEFAULTS.maxRetries,
    retryDelay: options?.retryDelay ?? SAFE_DEFAULTS.retryDelay,
  };

  // If no retries requested, use standard implementation
  if (opts.maxRetries === 0) {
    if (HAS_NATIVE_RM_SYNC) {
      (fs as typeof fs & { rmSync: typeof safeRmSync }).rmSync(path, opts);
    } else {
      fallbackRmSync(path, opts);
    }
    return;
  }

  // Retry with exponential backoff
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      if (HAS_NATIVE_RM_SYNC) {
        // Use native but pass maxRetries=0 since we handle retries ourselves
        (fs as typeof fs & { rmSync: typeof safeRmSync }).rmSync(path, {
          ...opts,
          maxRetries: 0,
        });
      } else {
        fallbackRmSync(path, { ...opts, maxRetries: 0 });
      }
      return; // Success
    } catch (err) {
      // Handle ENOENT with force
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' && opts.force) {
        return;
      }

      // Try EPERM fix on Windows
      if (shouldFixEPERM(err as NodeJS.ErrnoException)) {
        try {
          fixWinEPERMSync(path, err as NodeJS.ErrnoException);
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
      busyWait(delay);
    }
  }
}

export default safeRmSync;
