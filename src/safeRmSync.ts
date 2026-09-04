import fallbackRmSync from './fallback/rmSync.ts';
import { withSafeDefaults } from './retry.ts';
import type { RmOptions } from './types.ts';

/**
 * Remove a file or directory synchronously with Windows-friendly defaults.
 *
 * This is NOT a strict ponyfill - it provides enhanced behavior:
 * - Default recursive: true, force: true
 * - Default maxRetries: 10 on Windows, 0 on POSIX, with linear backoff per entry
 * - EPERM chmod fix before retry on Windows
 *
 * Always uses the fallback walk so retries are bounded per entry on every Node version.
 * Use this for CI/test cleanup. For strict fs.rmSync compatibility, use rmSync.
 *
 * @param path - Path to remove
 * @param options - Options (with Windows-friendly defaults)
 */
function safeRmSync(path: string, options?: RmOptions): void {
  fallbackRmSync(path, withSafeDefaults(options));
}

export default safeRmSync;
