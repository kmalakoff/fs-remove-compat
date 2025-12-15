import assert from 'assert';
import fs from 'fs';
import mkdirp from 'mkdirp-classic';
import path from 'path';
import url from 'url';

// Import fallback implementations directly
import fallbackRm from '../../src/fallback/rm.ts';
import fallbackRmSync from '../../src/fallback/rmSync.ts';

const ___filename = typeof __filename !== 'undefined' ? __filename : url.fileURLToPath(import.meta.url);
const ___dirname = path.dirname(___filename);

const TMP_DIR = path.join(___dirname, '..', '..', '.tmp', 'retry-test');

// Simple monkey-patching utilities for Node 0.8 compatibility (no sinon)
let originalFunctions: { [key: string]: unknown } = {};

function mockFs(name: string, mockFn: (...args: unknown[]) => unknown): void {
  // biome-ignore lint/suspicious/noExplicitAny: Dynamic property access on fs module
  originalFunctions[name] = (fs as any)[name];
  // biome-ignore lint/suspicious/noExplicitAny: Dynamic property access on fs module
  (fs as any)[name] = mockFn;
}

function _restoreFs(name: string): void {
  if (originalFunctions[name]) {
    // biome-ignore lint/suspicious/noExplicitAny: Dynamic property access on fs module
    (fs as any)[name] = originalFunctions[name];
    delete originalFunctions[name];
  }
}

function restoreAllFs(): void {
  for (const name in originalFunctions) {
    // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn not available in Node 0.8
    if (originalFunctions.hasOwnProperty(name)) {
      // biome-ignore lint/suspicious/noExplicitAny: Dynamic property access on fs module
      (fs as any)[name] = originalFunctions[name];
    }
  }
  originalFunctions = {};
}

function cleanTmp(): void {
  try {
    if (fs.existsSync(TMP_DIR)) {
      fallbackRmSync(TMP_DIR, { recursive: true, force: true });
    }
  } catch (_e) {
    // ignore
  }
}

function setupTmp(): void {
  cleanTmp();
  mkdirp.sync(TMP_DIR);
}

function createEBUSYError(): NodeJS.ErrnoException {
  const err = new Error('EBUSY: resource busy or locked') as NodeJS.ErrnoException;
  err.code = 'EBUSY';
  err.syscall = 'unlink';
  return err;
}

function createENOTEMPTYError(): NodeJS.ErrnoException {
  const err = new Error('ENOTEMPTY: directory not empty') as NodeJS.ErrnoException;
  err.code = 'ENOTEMPTY';
  err.syscall = 'rmdir';
  return err;
}

function createENOENTError(): NodeJS.ErrnoException {
  const err = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  return err;
}

function createEACCESError(): NodeJS.ErrnoException {
  const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
  err.code = 'EACCES';
  return err;
}

describe('retry paths (with mocking)', () => {
  beforeEach(setupTmp);
  afterEach(restoreAllFs);
  after(cleanTmp);

  describe('fallbackRm retry on EBUSY', () => {
    it('should retry on EBUSY and succeed', (done) => {
      const filePath = path.join(TMP_DIR, 'ebusy-file.txt');
      fs.writeFileSync(filePath, 'content');

      let callCount = 0;
      const originalUnlink = fs.unlink.bind(fs);
      mockFs('unlink', (p: fs.PathLike, cb: fs.NoParamCallback) => {
        callCount++;
        if (callCount === 1) {
          process.nextTick(() => {
            cb(createEBUSYError());
          });
        } else {
          originalUnlink(p, cb);
        }
      });

      fallbackRm(filePath, { maxRetries: 3, retryDelay: 10 }, (err) => {
        if (err) return done(err);
        assert.ok(!fs.existsSync(filePath));
        assert.equal(callCount, 2);
        done();
      });
    });

    it('should fail after max retries on EBUSY', (done) => {
      const filePath = path.join(TMP_DIR, 'ebusy-fail.txt');
      fs.writeFileSync(filePath, 'content');

      mockFs('unlink', (_p: fs.PathLike, cb: fs.NoParamCallback) => {
        process.nextTick(() => {
          cb(createEBUSYError());
        });
      });

      fallbackRm(filePath, { maxRetries: 2, retryDelay: 10 }, (err) => {
        assert.ok(err);
        assert.equal(err?.code, 'EBUSY');
        done();
      });
    });
  });

  describe('fallbackRm retry on rmdir ENOTEMPTY', () => {
    it('should retry rmdir on ENOTEMPTY and succeed', (done) => {
      const dirPath = path.join(TMP_DIR, 'enotempty-dir');
      mkdirp.sync(dirPath);

      let callCount = 0;
      const originalRmdir = fs.rmdir.bind(fs);
      mockFs('rmdir', (p: fs.PathLike, cb: fs.NoParamCallback) => {
        callCount++;
        if (callCount === 1) {
          process.nextTick(() => {
            cb(createENOTEMPTYError());
          });
        } else {
          originalRmdir(p, cb);
        }
      });

      fallbackRm(dirPath, { recursive: true, maxRetries: 3, retryDelay: 10 }, (err) => {
        if (err) return done(err);
        assert.ok(!fs.existsSync(dirPath));
        done();
      });
    });
  });

  describe('fallbackRm ENOENT handling in unlink', () => {
    it('should handle ENOENT in unlink without force', (done) => {
      const filePath = path.join(TMP_DIR, 'enoent-unlink.txt');
      // Don't create the file

      fallbackRm(filePath, undefined, (err) => {
        assert.ok(err);
        assert.equal(err?.code, 'ENOENT');
        done();
      });
    });

    it('should ignore ENOENT in unlink with force', (done) => {
      const filePath = path.join(TMP_DIR, 'enoent-unlink-force.txt');
      // Don't create the file

      fallbackRm(filePath, { force: true }, (err) => {
        assert.ok(!err);
        done();
      });
    });

    it('should handle ENOENT race in unlink without force (file disappears after lstat)', (done) => {
      const filePath = path.join(TMP_DIR, 'enoent-race.txt');
      fs.writeFileSync(filePath, 'content');

      // Mock unlink to fail with ENOENT (race: file was deleted between lstat and unlink)
      mockFs('unlink', (_p: fs.PathLike, cb: fs.NoParamCallback) => {
        process.nextTick(() => {
          cb(createENOENTError());
        });
      });

      fallbackRm(filePath, undefined, (err) => {
        assert.ok(err);
        assert.equal(err?.code, 'ENOENT');
        done();
      });
    });

    it('should ignore ENOENT race in unlink with force (file disappears after lstat)', (done) => {
      const filePath = path.join(TMP_DIR, 'enoent-race-force.txt');
      fs.writeFileSync(filePath, 'content');

      // Mock unlink to fail with ENOENT (race: file was deleted between lstat and unlink)
      mockFs('unlink', (_p: fs.PathLike, cb: fs.NoParamCallback) => {
        process.nextTick(() => {
          cb(createENOENTError());
        });
      });

      fallbackRm(filePath, { force: true }, (err) => {
        assert.ok(!err);
        done();
      });
    });
  });

  describe('fallbackRm ENOENT handling in rmdir', () => {
    it('should handle ENOENT in rmdir without force', (done) => {
      const dirPath = path.join(TMP_DIR, 'enoent-rmdir');
      mkdirp.sync(dirPath);

      mockFs('rmdir', (_p: fs.PathLike, cb: fs.NoParamCallback) => {
        process.nextTick(() => {
          cb(createENOENTError());
        });
      });

      fallbackRm(dirPath, { recursive: true }, (err) => {
        assert.ok(err);
        assert.equal(err?.code, 'ENOENT');
        done();
      });
    });

    it('should ignore ENOENT in rmdir with force', (done) => {
      const dirPath = path.join(TMP_DIR, 'enoent-rmdir-force');
      mkdirp.sync(dirPath);

      mockFs('rmdir', (_p: fs.PathLike, cb: fs.NoParamCallback) => {
        process.nextTick(() => {
          cb(createENOENTError());
        });
      });

      fallbackRm(dirPath, { recursive: true, force: true }, (err) => {
        assert.ok(!err);
        done();
      });
    });
  });

  describe('fallbackRmSync retry on EBUSY', () => {
    it('should retry on EBUSY and succeed', () => {
      const filePath = path.join(TMP_DIR, 'ebusy-sync.txt');
      fs.writeFileSync(filePath, 'content');

      let callCount = 0;
      const originalUnlinkSync = fs.unlinkSync.bind(fs);
      mockFs('unlinkSync', (p: fs.PathLike) => {
        callCount++;
        if (callCount === 1) {
          throw createEBUSYError();
        }
        return originalUnlinkSync(p);
      });

      fallbackRmSync(filePath, { maxRetries: 3, retryDelay: 10 });
      assert.ok(!fs.existsSync(filePath));
      assert.equal(callCount, 2);
    });

    it('should fail after max retries on EBUSY', () => {
      const filePath = path.join(TMP_DIR, 'ebusy-sync-fail.txt');
      fs.writeFileSync(filePath, 'content');

      mockFs('unlinkSync', () => {
        throw createEBUSYError();
      });

      try {
        fallbackRmSync(filePath, { maxRetries: 2, retryDelay: 10 });
        assert.fail('should have thrown');
      } catch (err: unknown) {
        assert.equal((err as NodeJS.ErrnoException).code, 'EBUSY');
      }
    });
  });

  describe('fallbackRmSync retry on rmdir ENOTEMPTY', () => {
    it('should retry rmdirSync on ENOTEMPTY and succeed', () => {
      const dirPath = path.join(TMP_DIR, 'enotempty-sync');
      mkdirp.sync(dirPath);

      let callCount = 0;
      const originalRmdirSync = fs.rmdirSync.bind(fs);
      mockFs('rmdirSync', (p: fs.PathLike) => {
        callCount++;
        if (callCount === 1) {
          throw createENOTEMPTYError();
        }
        return originalRmdirSync(p);
      });

      fallbackRmSync(dirPath, { recursive: true, maxRetries: 3, retryDelay: 10 });
      assert.ok(!fs.existsSync(dirPath));
    });

    it('should fail after max retries on ENOTEMPTY', () => {
      const dirPath = path.join(TMP_DIR, 'enotempty-sync-fail');
      mkdirp.sync(dirPath);

      mockFs('rmdirSync', () => {
        throw createENOTEMPTYError();
      });

      try {
        fallbackRmSync(dirPath, { recursive: true, maxRetries: 2, retryDelay: 10 });
        assert.fail('should have thrown');
      } catch (err: unknown) {
        assert.equal((err as NodeJS.ErrnoException).code, 'ENOTEMPTY');
      }
    });
  });

  describe('fallbackRmSync ENOENT handling', () => {
    it('should handle ENOENT in rmdirSync without force', () => {
      const dirPath = path.join(TMP_DIR, 'enoent-sync-rmdir');
      mkdirp.sync(dirPath);

      mockFs('rmdirSync', () => {
        throw createENOENTError();
      });

      try {
        fallbackRmSync(dirPath, { recursive: true });
        assert.fail('should have thrown');
      } catch (err: unknown) {
        assert.equal((err as NodeJS.ErrnoException).code, 'ENOENT');
      }
    });

    it('should ignore ENOENT in rmdirSync with force', () => {
      const dirPath = path.join(TMP_DIR, 'enoent-sync-rmdir-force');
      mkdirp.sync(dirPath);

      mockFs('rmdirSync', () => {
        throw createENOENTError();
      });

      // Should not throw with force
      fallbackRmSync(dirPath, { recursive: true, force: true });
    });

    it('should handle ENOENT race in unlinkSync without force', () => {
      const filePath = path.join(TMP_DIR, 'enoent-sync-race.txt');
      fs.writeFileSync(filePath, 'content');

      mockFs('unlinkSync', () => {
        throw createENOENTError();
      });

      try {
        fallbackRmSync(filePath);
        assert.fail('should have thrown');
      } catch (err: unknown) {
        assert.equal((err as NodeJS.ErrnoException).code, 'ENOENT');
      }
    });

    it('should ignore ENOENT race in unlinkSync with force', () => {
      const filePath = path.join(TMP_DIR, 'enoent-sync-race-force.txt');
      fs.writeFileSync(filePath, 'content');

      mockFs('unlinkSync', () => {
        throw createENOENTError();
      });

      // Should not throw with force
      fallbackRmSync(filePath, { force: true });
    });

    it('should handle ENOENT in readdirSync without force', () => {
      const dirPath = path.join(TMP_DIR, 'enoent-readdir-sync');
      mkdirp.sync(dirPath);

      // Mock lstatSync to return directory stats
      mockFs('lstatSync', () => ({ isDirectory: () => true }) as fs.Stats);

      // Mock readdirSync to fail with ENOENT
      mockFs('readdirSync', () => {
        throw createENOENTError();
      });

      try {
        fallbackRmSync(dirPath, { recursive: true });
        assert.fail('should have thrown');
      } catch (err: unknown) {
        assert.equal((err as NodeJS.ErrnoException).code, 'ENOENT');
      }
    });

    it('should ignore ENOENT in readdirSync with force', () => {
      const dirPath = path.join(TMP_DIR, 'enoent-readdir-sync-force');
      mkdirp.sync(dirPath);

      // Mock lstatSync to return directory stats
      mockFs('lstatSync', () => ({ isDirectory: () => true }) as fs.Stats);

      // Mock readdirSync to fail with ENOENT
      mockFs('readdirSync', () => {
        throw createENOENTError();
      });

      // Should not throw with force
      fallbackRmSync(dirPath, { recursive: true, force: true });
    });
  });

  describe('non-retryable errors', () => {
    it('should not retry on EACCES (async)', (done) => {
      const filePath = path.join(TMP_DIR, 'eacces.txt');
      fs.writeFileSync(filePath, 'content');

      let callCount = 0;
      mockFs('unlink', (_p: fs.PathLike, cb: fs.NoParamCallback) => {
        callCount++;
        process.nextTick(() => {
          cb(createEACCESError());
        });
      });

      fallbackRm(filePath, { maxRetries: 3, retryDelay: 10 }, (err) => {
        assert.ok(err);
        assert.equal(err?.code, 'EACCES');
        assert.equal(callCount, 1); // Should not retry
        done();
      });
    });

    it('should not retry on EACCES (sync)', () => {
      const filePath = path.join(TMP_DIR, 'eacces-sync.txt');
      fs.writeFileSync(filePath, 'content');

      let callCount = 0;
      mockFs('unlinkSync', () => {
        callCount++;
        throw createEACCESError();
      });

      try {
        fallbackRmSync(filePath, { maxRetries: 3, retryDelay: 10 });
        assert.fail('should have thrown');
      } catch (err: unknown) {
        assert.equal((err as NodeJS.ErrnoException).code, 'EACCES');
        assert.equal(callCount, 1); // Should not retry
      }
    });
  });

  describe('recursive directory error paths', () => {
    it('should handle lstat error without force (async)', (done) => {
      const dirPath = path.join(TMP_DIR, 'lstat-error-async');
      mkdirp.sync(dirPath);

      // Mock readdir to return an entry
      mockFs('readdir', (_p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, files: string[]) => void) => {
        cb(null, ['file.txt']);
      });

      // Mock lstat to fail with ENOENT
      mockFs('lstat', (_p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, stats: fs.Stats) => void) => {
        cb(createENOENTError(), undefined as unknown as fs.Stats);
      });

      fallbackRm(dirPath, { recursive: true }, (err) => {
        assert.ok(err);
        assert.equal(err?.code, 'ENOENT');
        done();
      });
    });

    it('should handle lstat error with force - skip entry (async)', (done) => {
      const dirPath = path.join(TMP_DIR, 'lstat-error-force-async');
      mkdirp.sync(dirPath);

      // Mock readdir to return an entry
      mockFs('readdir', (_p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, files: string[]) => void) => {
        cb(null, ['file.txt']);
      });

      // Mock lstat to fail with ENOENT
      mockFs('lstat', (_p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, stats: fs.Stats) => void) => {
        cb(createENOENTError(), undefined as unknown as fs.Stats);
      });

      // Mock rmdir to succeed
      mockFs('rmdir', (_p: fs.PathLike, cb: fs.NoParamCallback) => {
        process.nextTick(() => {
          cb(null);
        });
      });

      fallbackRm(dirPath, { recursive: true, force: true }, (err) => {
        assert.ok(!err);
        done();
      });
    });

    it('should handle unlinkWithRetry error in recursive without force (async)', (done) => {
      const dirPath = path.join(TMP_DIR, 'unlink-error-recursive');
      mkdirp.sync(dirPath);

      // Mock readdir to return an entry
      mockFs('readdir', (_p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, files: string[]) => void) => {
        cb(null, ['file.txt']);
      });

      // Mock lstat to return file stats
      mockFs('lstat', (_p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, stats: fs.Stats) => void) => {
        cb(null, { isDirectory: () => false } as fs.Stats);
      });

      // Mock unlink to fail
      mockFs('unlink', (_p: fs.PathLike, cb: fs.NoParamCallback) => {
        process.nextTick(() => {
          cb(createEACCESError());
        });
      });

      fallbackRm(dirPath, { recursive: true }, (err) => {
        assert.ok(err);
        assert.equal(err?.code, 'EACCES');
        done();
      });
    });

    it('should handle readdir ENOENT without force (async)', (done) => {
      const dirPath = path.join(TMP_DIR, 'readdir-enoent-async');
      mkdirp.sync(dirPath);

      // Keep original lstat so it sees the directory
      const originalLstat = fs.lstat.bind(fs);
      mockFs('lstat', originalLstat);

      // Mock readdir to fail with ENOENT
      mockFs('readdir', (_p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, files: string[]) => void) => {
        cb(createENOENTError(), undefined as unknown as string[]);
      });

      fallbackRm(dirPath, { recursive: true }, (err) => {
        assert.ok(err);
        assert.equal(err?.code, 'ENOENT');
        done();
      });
    });

    it('should ignore readdir ENOENT with force (async)', (done) => {
      const dirPath = path.join(TMP_DIR, 'readdir-enoent-force-async');
      mkdirp.sync(dirPath);

      // Keep original lstat so it sees the directory
      const originalLstat = fs.lstat.bind(fs);
      mockFs('lstat', originalLstat);

      // Mock readdir to fail with ENOENT
      mockFs('readdir', (_p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, files: string[]) => void) => {
        cb(createENOENTError(), undefined as unknown as string[]);
      });

      fallbackRm(dirPath, { recursive: true, force: true }, (err) => {
        assert.ok(!err);
        done();
      });
    });

    it('should handle non-ENOENT readdir error (async)', (done) => {
      const dirPath = path.join(TMP_DIR, 'readdir-other-error-async');
      mkdirp.sync(dirPath);

      // Keep original lstat so it sees the directory
      const originalLstat = fs.lstat.bind(fs);
      mockFs('lstat', originalLstat);

      // Mock readdir to fail with EACCES
      mockFs('readdir', (_p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, files: string[]) => void) => {
        cb(createEACCESError(), undefined as unknown as string[]);
      });

      fallbackRm(dirPath, { recursive: true, force: true }, (err) => {
        assert.ok(err);
        assert.equal(err?.code, 'EACCES');
        done();
      });
    });
  });

  describe('sync recursive error paths', () => {
    it('should handle lstat error without force (sync)', () => {
      const dirPath = path.join(TMP_DIR, 'lstat-error-sync');
      mkdirp.sync(dirPath);

      // Mock readdirSync to return an entry
      mockFs('readdirSync', () => ['file.txt']);

      // Mock lstatSync to fail with ENOENT
      mockFs('lstatSync', () => {
        throw createENOENTError();
      });

      try {
        fallbackRmSync(dirPath, { recursive: true });
        assert.fail('should have thrown');
      } catch (err: unknown) {
        assert.equal((err as NodeJS.ErrnoException).code, 'ENOENT');
      }
    });

    it('should handle lstat error with force - continue (sync)', () => {
      const dirPath = path.join(TMP_DIR, 'lstat-error-force-sync');
      mkdirp.sync(dirPath);

      // Mock readdirSync to return an entry
      mockFs('readdirSync', () => ['file.txt']);

      // Mock lstatSync to fail with ENOENT
      mockFs('lstatSync', () => {
        throw createENOENTError();
      });

      // Mock rmdirSync to succeed
      mockFs('rmdirSync', () => undefined);

      // Should not throw with force
      fallbackRmSync(dirPath, { recursive: true, force: true });
    });

    it('should handle unlinkSync error in recursive (sync)', () => {
      const dirPath = path.join(TMP_DIR, 'unlink-error-sync');
      mkdirp.sync(dirPath);

      // Mock readdirSync to return an entry
      mockFs('readdirSync', () => ['file.txt']);

      // Mock lstatSync to return file stats
      mockFs('lstatSync', () => ({ isDirectory: () => false }) as fs.Stats);

      // Mock unlinkSync to fail
      mockFs('unlinkSync', () => {
        throw createEACCESError();
      });

      try {
        fallbackRmSync(dirPath, { recursive: true });
        assert.fail('should have thrown');
      } catch (err: unknown) {
        assert.equal((err as NodeJS.ErrnoException).code, 'EACCES');
      }
    });
  });

  describe('hasError early return path', () => {
    it('should report first error and ignore subsequent callbacks (async)', (done) => {
      const dirPath = path.join(TMP_DIR, 'haserror-path');
      mkdirp.sync(dirPath);

      let doneCallCount = 0;

      // Mock readdir to return two entries
      mockFs('readdir', (_p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, files: string[]) => void) => {
        cb(null, ['file1.txt', 'file2.txt']);
      });

      // Mock lstat - both fail with EACCES
      mockFs('lstat', (_p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, stats: fs.Stats) => void) => {
        process.nextTick(() => {
          cb(createEACCESError(), undefined as unknown as fs.Stats);
        });
      });

      fallbackRm(dirPath, { recursive: true }, (err) => {
        doneCallCount++;
        // This should only be called once despite two entries failing
        if (doneCallCount === 1) {
          assert.ok(err);
          assert.equal(err?.code, 'EACCES');
          // Give time for potential second callback
          setTimeout(() => {
            assert.equal(doneCallCount, 1);
            done();
          }, 50);
        }
      });
    });
  });
});
