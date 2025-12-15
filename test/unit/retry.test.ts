import assert from 'assert';

// Import retry utilities directly
import { busyWait, getBackoffDelay, isRetryableError, SAFE_DEFAULTS } from '../../src/retry.ts';

const isWindows = process.platform === 'win32' || /^(msys|cygwin)$/.test(process.env.OSTYPE);

describe('retry utilities', () => {
  describe('SAFE_DEFAULTS', () => {
    it('should have correct default values', () => {
      assert.equal(SAFE_DEFAULTS.recursive, true);
      assert.equal(SAFE_DEFAULTS.force, true);
      assert.equal(SAFE_DEFAULTS.retryDelay, 100);
      // maxRetries depends on platform
      if (isWindows) {
        assert.equal(SAFE_DEFAULTS.maxRetries, 10);
      } else {
        assert.equal(SAFE_DEFAULTS.maxRetries, 0);
      }
    });
  });

  describe('isRetryableError', () => {
    it('should return false for non-Error', () => {
      assert.equal(isRetryableError(null), false);
      assert.equal(isRetryableError(undefined), false);
      assert.equal(isRetryableError('error'), false);
      assert.equal(isRetryableError(123), false);
      assert.equal(isRetryableError({}), false);
    });

    it('should return false for Error without code', () => {
      const err = new Error('test');
      assert.equal(isRetryableError(err), false);
    });

    it('should return true for EBUSY', () => {
      const err = new Error('EBUSY') as NodeJS.ErrnoException;
      err.code = 'EBUSY';
      assert.equal(isRetryableError(err), true);
    });

    it('should return true for EMFILE', () => {
      const err = new Error('EMFILE') as NodeJS.ErrnoException;
      err.code = 'EMFILE';
      assert.equal(isRetryableError(err), true);
    });

    it('should return true for ENFILE', () => {
      const err = new Error('ENFILE') as NodeJS.ErrnoException;
      err.code = 'ENFILE';
      assert.equal(isRetryableError(err), true);
    });

    it('should return true for ENOTEMPTY', () => {
      const err = new Error('ENOTEMPTY') as NodeJS.ErrnoException;
      err.code = 'ENOTEMPTY';
      assert.equal(isRetryableError(err), true);
    });

    it('should return true for EPERM', () => {
      const err = new Error('EPERM') as NodeJS.ErrnoException;
      err.code = 'EPERM';
      assert.equal(isRetryableError(err), true);
    });

    it('should return false for ENOENT', () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      assert.equal(isRetryableError(err), false);
    });

    it('should return false for EISDIR', () => {
      const err = new Error('EISDIR') as NodeJS.ErrnoException;
      err.code = 'EISDIR';
      assert.equal(isRetryableError(err), false);
    });
  });

  describe('getBackoffDelay', () => {
    it('should return base delay for attempt 0', () => {
      assert.equal(getBackoffDelay(100, 0), 100);
    });

    it('should apply exponential backoff', () => {
      // factor is 1.2
      // attempt 1: 100 * 1.2^1 = 120
      assert.equal(getBackoffDelay(100, 1), 120);
      // attempt 2: 100 * 1.2^2 = 144
      assert.equal(getBackoffDelay(100, 2), 144);
      // attempt 3: 100 * 1.2^3 = 172.8 -> 172
      assert.equal(getBackoffDelay(100, 3), 172);
    });

    it('should handle different base delays', () => {
      assert.equal(getBackoffDelay(50, 0), 50);
      assert.equal(getBackoffDelay(200, 0), 200);
      assert.equal(getBackoffDelay(50, 1), 60); // 50 * 1.2
    });
  });

  describe('busyWait', () => {
    it('should wait approximately the specified time', () => {
      const start = Date.now();
      busyWait(50);
      const elapsed = Date.now() - start;
      // Allow some tolerance
      assert.ok(elapsed >= 45, `Expected >= 45ms, got ${elapsed}ms`);
      assert.ok(elapsed < 100, `Expected < 100ms, got ${elapsed}ms`);
    });

    it('should handle 0ms', () => {
      const start = Date.now();
      busyWait(0);
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 50, `Expected < 50ms, got ${elapsed}ms`);
    });
  });
});
