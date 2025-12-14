/**
 * Retry utilities for safeRm/safeRmSync with exponential backoff.
 */

import Pinkie from 'pinkie-promise';

const isWindows = process.platform === 'win32' || /^(msys|cygwin)$/.test(process.env.OSTYPE);
const RETRYABLE_CODES = ['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM'];
const BACKOFF_FACTOR = 1.2;

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
 * Check if an error is retryable.
 */
export function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code !== undefined && RETRYABLE_CODES.indexOf(code) !== -1;
}

/**
 * Calculate exponential backoff delay.
 * delay * (factor ^ attempt)
 */
export function getBackoffDelay(baseDelay: number, attempt: number): number {
  return Math.floor(baseDelay * BACKOFF_FACTOR ** attempt);
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

/**
 * Async sleep.
 */
export function sleep(ms: number): Promise<void> {
  return new Pinkie((resolve) => setTimeout(resolve, ms));
}
