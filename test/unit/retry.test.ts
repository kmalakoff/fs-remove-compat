import assert from 'assert';

// Import retry utilities directly
import { busyWait, getRetryDelay, isRetryableError, SAFE_DEFAULTS, withSafeDefaults } from '../../src/retry.ts';

const isWindows = process.platform === 'win32' || /^(msys|cygwin)$/.test(process.env.OSTYPE ?? '');

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

  describe('withSafeDefaults', () => {
    it('should fill every option from SAFE_DEFAULTS', () => {
      assert.deepEqual(withSafeDefaults(), SAFE_DEFAULTS);
      assert.deepEqual(withSafeDefaults(undefined), SAFE_DEFAULTS);
    });

    it('should keep explicit options', () => {
      const opts = withSafeDefaults({ recursive: false, force: false, maxRetries: 3, retryDelay: 5 });
      assert.deepEqual(opts, { recursive: false, force: false, maxRetries: 3, retryDelay: 5 });
    });
  });

  describe('getRetryDelay', () => {
    it('should return base delay for attempt 0', () => {
      assert.equal(getRetryDelay(100, 0), 100);
    });

    it('should apply linear backoff', () => {
      assert.equal(getRetryDelay(100, 1), 200);
      assert.equal(getRetryDelay(100, 2), 300);
      assert.equal(getRetryDelay(100, 9), 1000);
    });

    it('should handle different base delays', () => {
      assert.equal(getRetryDelay(50, 0), 50);
      assert.equal(getRetryDelay(200, 0), 200);
      assert.equal(getRetryDelay(50, 1), 100);
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
