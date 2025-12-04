/**
 * Options for rm and rmSync functions.
 * Matches Node.js fs.rm/fs.rmSync options.
 */
export interface RmOptions {
  /** Remove directories recursively. Default: false */
  recursive?: boolean;
  /** Ignore errors if path doesn't exist. Default: false */
  force?: boolean;
  /** Number of retries on EBUSY, EMFILE, ENFILE, ENOTEMPTY, EPERM. Default: 0 */
  maxRetries?: number;
  /** Delay in ms between retries. Default: 100 */
  retryDelay?: number;
}

/**
 * Callback for async rm function.
 */
export type RmCallback = (err?: NodeJS.ErrnoException | null) => void;
