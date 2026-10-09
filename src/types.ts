import type { URL } from 'url';

export type RmPath = string | Buffer | URL;

/**
 * Options for rm and rmSync functions.
 * Matches Node.js fs.rm/fs.rmSync options.
 */
export interface RmOptions {
  /** Remove directories recursively. Default: false */
  recursive?: boolean;
  /** Ignore errors if path doesn't exist. Default: false */
  force?: boolean;
  /** Number of retries on EBUSY, EMFILE, ENFILE, ENOTEMPTY, EPERM. For strict rm/rmSync, ignored unless recursive is true. Default: 0 */
  maxRetries?: number;
  /** Delay in ms between retries. Ignored unless recursive is true. Default: 100 */
  retryDelay?: number;
}

/**
 * Callback for async rm function.
 */
export type RmCallback = (err?: NodeJS.ErrnoException | null) => void;
