import fs from 'fs';
import Pinkie from 'pinkie-promise';
import fallbackRm from './fallback/rm.js';
import type { RmCallback, RmOptions } from './types.js';

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

/**
 * Internal implementation that handles native vs fallback.
 */
function rmImpl(path: string, options: RmOptions | undefined, callback: RmCallback): void {
  if (HAS_NATIVE_RM) {
    (fs as typeof fs & { rm: (path: string, options: RmOptions | undefined, callback: RmCallback) => void }).rm(path, options, callback);
  } else {
    fallbackRm(path, options, callback);
  }
}

export default rm;
