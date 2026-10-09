import fs from 'fs';
import fallbackRmSync from './fallback/rmSync.ts';
import { validateNativeOptions } from './lib/options.ts';
import { validatePath } from './lib/path.ts';
import { isWindows } from './lib/platform.ts';
import type { RmOptions, RmPath } from './types.ts';

/**
 * Check if native fs.rmSync is available.
 * fs.rmSync was added in Node.js 14.14.0.
 */
const HAS_NATIVE_RM_SYNC = typeof (fs as typeof fs & { rmSync?: unknown }).rmSync === 'function';

/**
 * Remove a file or directory synchronously.
 *
 * This ponyfill delegates to native fs.rmSync and backports its documented removal options:
 * - Uses native fs.rmSync when available (Node 14.14+)
 * - Falls back to custom implementation for older Node versions
 *
 * On Windows, we handle symlinks specially because native fs.rmSync
 * can fail with ENOENT when calling stat on broken symlinks.
 *
 * @param path - Path to remove
 * @param options - Options
 * @param options.recursive - Remove directories recursively. Default: false
 * @param options.force - Ignore errors if path doesn't exist. Default: false
 * @param options.maxRetries - Retries on EBUSY/EPERM/etc. Default: 0
 * @param options.retryDelay - Delay between retries in ms. Default: 100
 */
function rmSync(path: RmPath, options?: RmOptions): void {
  if (HAS_NATIVE_RM_SYNC) {
    // On Windows, check if path is a symlink first to avoid native fs.rmSync bug
    // where it fails on broken symlinks (symlinks pointing to deleted targets)
    if (isWindows) {
      path = validatePath(path);
      options = validateNativeOptions(options);
      try {
        const stats = fs.lstatSync(path);
        if (stats.isSymbolicLink()) {
          try {
            fs.unlinkSync(path);
            return;
          } catch (unlinkErr) {
            if ((unlinkErr as NodeJS.ErrnoException).code === 'ENOENT' && options?.force) return;
            throw unlinkErr;
          }
        }
      } catch (lstatErr) {
        if ((lstatErr as NodeJS.ErrnoException).code === 'ENOENT' && options?.force) return;
        throw lstatErr;
      }
    }
    (fs as typeof fs & { rmSync: typeof rmSync }).rmSync(path, options);
  } else {
    fallbackRmSync(path, options);
  }
}

export default rmSync;
