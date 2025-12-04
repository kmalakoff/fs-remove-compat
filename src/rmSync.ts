import fs from 'fs';
import fallbackRmSync from './fallback/rmSync.ts';
import type { RmOptions } from './types.ts';

/**
 * Check if native fs.rmSync is available.
 * fs.rmSync was added in Node.js 14.14.0.
 */
const HAS_NATIVE_RM_SYNC = typeof (fs as typeof fs & { rmSync?: unknown }).rmSync === 'function';

/**
 * Remove a file or directory synchronously.
 *
 * This is a ponyfill that exactly matches Node.js fs.rmSync behavior:
 * - Uses native fs.rmSync when available (Node 14.14+)
 * - Falls back to custom implementation for older Node versions
 *
 * @param path - Path to remove
 * @param options - Options
 * @param options.recursive - Remove directories recursively. Default: false
 * @param options.force - Ignore errors if path doesn't exist. Default: false
 * @param options.maxRetries - Retries on EBUSY/EPERM/etc. Default: 0
 * @param options.retryDelay - Delay between retries in ms. Default: 100
 */
function rmSync(path: string, options?: RmOptions): void {
  if (HAS_NATIVE_RM_SYNC) {
    (fs as typeof fs & { rmSync: typeof rmSync }).rmSync(path, options);
  } else {
    fallbackRmSync(path, options);
  }
}

export default rmSync;
