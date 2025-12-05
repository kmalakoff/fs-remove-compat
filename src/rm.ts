import fs from 'fs';
import Pinkie from 'pinkie-promise';
import fallbackRm from './fallback/rm.ts';
import type { RmCallback, RmOptions } from './types.ts';

/**
 * Check if native fs.rm is available.
 * fs.rm was added in Node.js 14.14.0.
 */
const HAS_NATIVE_RM = typeof (fs as typeof fs & { rm?: unknown }).rm === 'function';

/**
 * Remove a file or directory asynchronously.
 *
 * This is a ponyfill that exactly matches Node.js fs.rm behavior:
 * - Uses native fs.rm when available (Node 14.14+)
 * - Falls back to custom implementation for older Node versions
 * - Supports both callback and Promise styles
 */
function rm(path: string, callback: RmCallback): void;
function rm(path: string, options: RmOptions, callback: RmCallback): void;
function rm(path: string, options?: RmOptions): Promise<void>;
function rm(path: string, optionsOrCallback?: RmOptions | RmCallback, maybeCallback?: RmCallback): void | Promise<void> {
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
    return new Pinkie((resolve, reject) => {
      rmImpl(path, options, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Callback style
  rmImpl(path, options, callback);
}

const IS_WINDOWS = process.platform === 'win32';

/**
 * Internal implementation that handles native vs fallback.
 * On Windows, we need to handle symlinks specially because native fs.rm
 * can fail with ENOENT when calling stat on broken symlinks.
 */
function rmImpl(path: string, options: RmOptions | undefined, callback: RmCallback): void {
  if (HAS_NATIVE_RM) {
    // On Windows, check if path is a symlink first to avoid native fs.rm bug
    // where it fails on broken symlinks (symlinks pointing to deleted targets)
    if (IS_WINDOWS) {
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
          (fs as typeof fs & { rm: (path: string, options: RmOptions | undefined, callback: RmCallback) => void }).rm(path, options, callback);
        }
      });
    } else {
      (fs as typeof fs & { rm: (path: string, options: RmOptions | undefined, callback: RmCallback) => void }).rm(path, options, callback);
    }
  } else {
    fallbackRm(path, options, callback);
  }
}

export default rm;
