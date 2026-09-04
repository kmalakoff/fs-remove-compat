import type { RmOptions } from './types.ts';

/**
 * Retry utilities shared by the fallback walk and the safe variants.
 */

const isWindows = process.platform === 'win32' || /^(msys|cygwin)$/.test(process.env.OSTYPE ?? '');
const RETRYABLE_CODES = ['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM'];

/**
 * Default options for safe variants.
 * Windows gets automatic retries, POSIX does not.
 */
export const SAFE_DEFAULTS = {
  recursive: true,
  force: true,
  maxRetries: isWindows ? 10 : 0,
  retryDelay: 100,
};

/**
 * Fill missing options from SAFE_DEFAULTS.
 */
export function withSafeDefaults(options?: RmOptions): Required<RmOptions> {
  return {
    recursive: options?.recursive ?? SAFE_DEFAULTS.recursive,
    force: options?.force ?? SAFE_DEFAULTS.force,
    maxRetries: options?.maxRetries ?? SAFE_DEFAULTS.maxRetries,
    retryDelay: options?.retryDelay ?? SAFE_DEFAULTS.retryDelay,
  };
}

/**
 * Check if an error is retryable.
 */
export function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code !== undefined && RETRYABLE_CODES.indexOf(code) !== -1;
}

/**
 * Delay before the next attempt. Linear backoff matching Node.js fs.rm: retryDelay * (attempt + 1).
 */
export function getRetryDelay(retryDelay: number, attempt: number): number {
  return retryDelay * (attempt + 1);
}

/**
 * Busy-wait for sync operations.
 */
export function busyWait(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Busy wait
  }
}
