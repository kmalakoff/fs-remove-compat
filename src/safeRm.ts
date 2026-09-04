import fallbackRm from './fallback/rm.ts';
import { withSafeDefaults } from './retry.ts';
import type { RmCallback, RmOptions } from './types.ts';

/**
 * Remove a file or directory asynchronously with Windows-friendly defaults.
 *
 * This is NOT a strict ponyfill - it provides enhanced behavior:
 * - Default recursive: true, force: true
 * - Default maxRetries: 10 on Windows, 0 on POSIX, with linear backoff per entry
 * - EPERM chmod fix before retry on Windows
 *
 * Always uses the fallback walk: native fs.rm retries at every directory level, so a stuck
 * entry in a deep tree waits maxRetries^depth times, and it reports errors while entries are
 * still being deleted. Use this for CI/test cleanup. For strict fs.rm compatibility, use rm.
 */
function safeRm(path: string, callback: RmCallback): void;
function safeRm(path: string, options: RmOptions, callback: RmCallback): void;
function safeRm(path: string, optionsOrCallback: RmOptions | RmCallback, maybeCallback?: RmCallback): void {
  const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
  const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : (maybeCallback as RmCallback);
  fallbackRm(path, withSafeDefaults(options), callback);
}

export default safeRm;
