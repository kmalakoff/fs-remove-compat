import fs from 'fs';
import fallbackRm from './fallback/rm.ts';
import { validateCallback, validateNativeOptions } from './lib/options.ts';
import { validatePath } from './lib/path.ts';
import { isWindows } from './lib/platform.ts';
import type { RmCallback, RmOptions, RmPath } from './types.ts';

/**
 * Check if native fs.rm is available.
 * fs.rm was added in Node.js 14.14.0.
 */
const HAS_NATIVE_RM = typeof (fs as typeof fs & { rm?: unknown }).rm === 'function';

/**
 * Remove a file or directory asynchronously.
 *
 * This ponyfill delegates to native fs.rm and backports its documented removal options:
 * - Uses native fs.rm when available (Node 14.14+)
 * - Falls back to custom implementation for older Node versions
 */
function rm(path: RmPath, callback: RmCallback): void;
function rm(path: RmPath, options: RmOptions, callback: RmCallback): void;
function rm(path: RmPath, optionsOrCallback: RmOptions | RmCallback, maybeCallback?: RmCallback): void {
  // Parse arguments
  if (typeof optionsOrCallback === 'function') {
    rmImpl(path, undefined, optionsOrCallback);
  } else {
    rmImpl(path, optionsOrCallback, maybeCallback as RmCallback);
  }
}

/**
 * Internal implementation that handles native vs fallback.
 * On Windows, we need to handle symlinks specially because native fs.rm
 * can fail with ENOENT when calling stat on broken symlinks.
 */
function rmImpl(path: RmPath, options: RmOptions | undefined, callback: RmCallback) {
  validateCallback(callback);
  if (HAS_NATIVE_RM) {
    // On Windows, check if path is a symlink first to avoid native fs.rm bug
    // where it fails on broken symlinks (symlinks pointing to deleted targets)
    if (isWindows) {
      path = validatePath(path);
      options = validateNativeOptions(options);
      fs.lstat(path, (lstatErr, stats) => {
        if (lstatErr) {
          // If lstat fails with ENOENT and force is set, succeed silently
          if (lstatErr.code === 'ENOENT' && options?.force) return callback();
          return callback(lstatErr);
        }
        // If it's a symlink, use unlink directly instead of native fs.rm
        if (stats.isSymbolicLink()) {
          fs.unlink(path, (unlinkErr) => {
            if (unlinkErr && unlinkErr.code === 'ENOENT' && options?.force) return callback();
            callback(unlinkErr);
          });
        } else {
          (fs as typeof fs & { rm: (path: RmPath, options: RmOptions | undefined, callback: RmCallback) => void }).rm(path, options, callback);
        }
      });
    } else {
      (fs as typeof fs & { rm: (path: RmPath, options: RmOptions | undefined, callback: RmCallback) => void }).rm(path, options, callback);
    }
  } else {
    fallbackRm(path, options, callback);
  }
}

export default rm;
