import assert from 'assert';
import fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import mkdirp from 'mkdirp-classic';
import path from 'path';
// Import fallback implementations directly
import fallbackRm from '../../../src/fallback/rm.ts';
import { createScratch, TMP_DIR } from '../../lib/scratch.ts';

const { setupTmp, cleanTmp } = createScratch(safeRmSync);
const SUITE_TMP_DIR = path.join(TMP_DIR, 'fallback-rm');

// Simple monkey-patching utilities for Node 0.8 compatibility (no sinon)
let originalFunctions: { [key: string]: unknown } = {};

function mockFs(name: string, mockFn: (...args: never[]) => unknown): void {
  // biome-ignore lint/suspicious/noExplicitAny: Dynamic property access on fs module
  originalFunctions[name] = (fs as any)[name];
  // biome-ignore lint/suspicious/noExplicitAny: Dynamic property access on fs module
  (fs as any)[name] = mockFn;
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

function createEPERMError(syscall: string): NodeJS.ErrnoException {
  const err = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException;
  err.code = 'EPERM';
  err.syscall = syscall;
  return err;
}

describe('fallback implementations', () => {
  beforeEach(setupTmp);
  beforeEach(() => mkdirp.sync(SUITE_TMP_DIR));
  after(cleanTmp);
  afterEach(restoreAllFs);

  describe('fallbackRm', () => {
    it('should remove a file (callback)', (done) => {
      const filePath = path.join(SUITE_TMP_DIR, 'test-file-cb.txt');
      fs.writeFileSync(filePath, 'content');

      fallbackRm(filePath, undefined, (err) => {
        if (err) return done(err);
        assert.ok(!fs.existsSync(filePath));
        done();
      });
    });

    it('should error when file does not exist (callback)', (done) => {
      const filePath = path.join(SUITE_TMP_DIR, 'nonexistent.txt');

      fallbackRm(filePath, undefined, (err) => {
        assert.ok(err);
        assert.equal(err?.code, 'ENOENT');
        done();
      });
    });

    it('should not error with force option (callback)', (done) => {
      const filePath = path.join(SUITE_TMP_DIR, 'nonexistent.txt');

      fallbackRm(filePath, { force: true }, (err) => {
        assert.ok(!err);
        done();
      });
    });

    it('should error on directory without recursive (callback)', (done) => {
      const dirPath = path.join(SUITE_TMP_DIR, 'test-dir-cb');
      mkdirp.sync(dirPath);

      fallbackRm(dirPath, undefined, (err) => {
        assert.ok(err);
        assert.equal(err?.code, 'EISDIR');
        done();
      });
    });

    it('should remove directory recursively (callback)', (done) => {
      const dirPath = path.join(SUITE_TMP_DIR, 'recursive-dir-cb');
      mkdirp.sync(path.join(dirPath, 'subdir'));
      fs.writeFileSync(path.join(dirPath, 'file1.txt'), 'content1');
      fs.writeFileSync(path.join(dirPath, 'subdir', 'file2.txt'), 'content2');

      fallbackRm(dirPath, { recursive: true }, (err) => {
        if (err) return done(err);
        assert.ok(!fs.existsSync(dirPath));
        done();
      });
    });

    it('should remove empty directory with recursive (callback)', (done) => {
      const dirPath = path.join(SUITE_TMP_DIR, 'empty-dir-cb');
      mkdirp.sync(dirPath);

      fallbackRm(dirPath, { recursive: true }, (err) => {
        if (err) return done(err);
        assert.ok(!fs.existsSync(dirPath));
        done();
      });
    });

    it('should handle force on missing file in directory (callback)', (done) => {
      const dirPath = path.join(SUITE_TMP_DIR, 'partial-dir-cb');
      mkdirp.sync(dirPath);
      fs.writeFileSync(path.join(dirPath, 'file.txt'), 'content');

      // Remove file manually to simulate race condition
      fs.unlinkSync(path.join(dirPath, 'file.txt'));

      fallbackRm(dirPath, { recursive: true, force: true }, (err) => {
        if (err) return done(err);
        assert.ok(!fs.existsSync(dirPath));
        done();
      });
    });

    it('should respect maxRetries option (callback)', (done) => {
      const filePath = path.join(SUITE_TMP_DIR, 'retry-file-cb.txt');
      fs.writeFileSync(filePath, 'content');

      fallbackRm(filePath, { maxRetries: 3, retryDelay: 10 }, (err) => {
        if (err) return done(err);
        assert.ok(!fs.existsSync(filePath));
        done();
      });
    });

    it('should handle readdir error with force', (done) => {
      const dirPath = path.join(SUITE_TMP_DIR, 'readdir-error');
      // Don't create the directory - should handle ENOENT with force
      fallbackRm(dirPath, { recursive: true, force: true }, (err) => {
        assert.ok(!err);
        done();
      });
    });

    it('should handle lstat error on directory entry with force', (done) => {
      const dirPath = path.join(SUITE_TMP_DIR, 'lstat-error-dir');
      mkdirp.sync(dirPath);
      fs.writeFileSync(path.join(dirPath, 'file.txt'), 'content');

      // Start the removal, then race by removing the file
      let removed = false;
      const interval = setInterval(() => {
        if (!removed && fs.existsSync(path.join(dirPath, 'file.txt'))) {
          try {
            fs.unlinkSync(path.join(dirPath, 'file.txt'));
            removed = true;
          } catch (_e) {
            // ignore
          }
        }
      }, 1);

      fallbackRm(dirPath, { recursive: true, force: true }, (err) => {
        clearInterval(interval);
        // Should succeed with force even if file disappeared
        assert.ok(!err || err.code === 'ENOENT');
        done();
      });
    });

    it('should handle error on file removal in directory without force', (done) => {
      const dirPath = path.join(SUITE_TMP_DIR, 'file-error-dir');
      mkdirp.sync(dirPath);
      fs.writeFileSync(path.join(dirPath, 'file.txt'), 'content');

      // Remove file to simulate ENOENT during recursive removal
      fs.unlinkSync(path.join(dirPath, 'file.txt'));

      fallbackRm(dirPath, { recursive: true }, (err) => {
        // Should succeed since directory is now empty
        if (err) return done(err);
        assert.ok(!fs.existsSync(dirPath));
        done();
      });
    });

    it('should handle stat error with force on initial path', (done) => {
      const filePath = path.join(SUITE_TMP_DIR, 'stat-error.txt');
      // File doesn't exist - should succeed with force
      fallbackRm(filePath, { force: true }, (err) => {
        assert.ok(!err);
        done();
      });
    });

    it('should propagate stat error without force', (done) => {
      const filePath = path.join(SUITE_TMP_DIR, 'stat-error-no-force.txt');
      // File doesn't exist - should error without force
      fallbackRm(filePath, undefined, (err) => {
        assert.ok(err);
        assert.equal(err?.code, 'ENOENT');
        done();
      });
    });
  });

  describe('fallbackRm retry on EBUSY', () => {
    it('should retry on EBUSY and succeed', (done) => {
      const filePath = path.join(SUITE_TMP_DIR, 'ebusy-file.txt');
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
      const filePath = path.join(SUITE_TMP_DIR, 'ebusy-fail.txt');
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
      const dirPath = path.join(SUITE_TMP_DIR, 'enotempty-dir');
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
      const filePath = path.join(SUITE_TMP_DIR, 'enoent-unlink.txt');
      // Don't create the file

      fallbackRm(filePath, undefined, (err) => {
        assert.ok(err);
        assert.equal(err?.code, 'ENOENT');
        done();
      });
    });

    it('should ignore ENOENT in unlink with force', (done) => {
      const filePath = path.join(SUITE_TMP_DIR, 'enoent-unlink-force.txt');
      // Don't create the file

      fallbackRm(filePath, { force: true }, (err) => {
        assert.ok(!err);
        done();
      });
    });

    it('should handle ENOENT race in unlink without force (file disappears after lstat)', (done) => {
      const filePath = path.join(SUITE_TMP_DIR, 'enoent-race.txt');
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
      const filePath = path.join(SUITE_TMP_DIR, 'enoent-race-force.txt');
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
      const dirPath = path.join(SUITE_TMP_DIR, 'enoent-rmdir');
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
      const dirPath = path.join(SUITE_TMP_DIR, 'enoent-rmdir-force');
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

  describe('non-retryable errors', () => {
    it('should not retry on EACCES (async)', (done) => {
      const filePath = path.join(SUITE_TMP_DIR, 'eacces.txt');
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
  });

  describe('recursive directory error paths', () => {
    it('should handle lstat error without force (async)', (done) => {
      const dirPath = path.join(SUITE_TMP_DIR, 'lstat-error-async');
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
      const dirPath = path.join(SUITE_TMP_DIR, 'lstat-error-force-async');
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
      const dirPath = path.join(SUITE_TMP_DIR, 'unlink-error-recursive');
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
      const dirPath = path.join(SUITE_TMP_DIR, 'readdir-enoent-async');
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
      const dirPath = path.join(SUITE_TMP_DIR, 'readdir-enoent-force-async');
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
      const dirPath = path.join(SUITE_TMP_DIR, 'readdir-other-error-async');
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

  describe('hasError early return path', () => {
    it('should report first error and ignore subsequent callbacks (async)', (done) => {
      const dirPath = path.join(SUITE_TMP_DIR, 'haserror-path');
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

  describe('lstat retry on a delete-pending entry', () => {
    // Windows reports a file whose delete is pending as EPERM from lstat until the last handle closes, then ENOENT.
    it('should retry lstat on EPERM and succeed once the entry is gone (async)', (done) => {
      const dirPath = path.join(SUITE_TMP_DIR, 'lstat-eperm-async');
      mkdirp.sync(dirPath);

      mockFs('readdir', (_p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, files: string[]) => void) => {
        cb(null, ['pending.exe']);
      });
      mockFs('chmod', (_p: fs.PathLike, _mode: fs.Mode, cb: fs.NoParamCallback) => {
        process.nextTick(() => cb(createEPERMError('chmod')));
      });

      let lstatCount = 0;
      const originalLstat = fs.lstat.bind(fs);
      mockFs('lstat', (p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, stats: fs.Stats) => void) => {
        if (p.toString() === dirPath) return originalLstat(p, cb);
        lstatCount++;
        process.nextTick(() => cb(lstatCount < 3 ? createEPERMError('lstat') : createENOENTError(), undefined as unknown as fs.Stats));
      });
      mockFs('rmdir', (_p: fs.PathLike, cb: fs.NoParamCallback) => {
        process.nextTick(() => cb(null));
      });

      fallbackRm(dirPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 1 }, (err) => {
        if (err) return done(err);
        assert.equal(lstatCount, 3);
        done();
      });
    });

    it('should fail after max retries when lstat keeps returning EPERM (async)', (done) => {
      const dirPath = path.join(SUITE_TMP_DIR, 'lstat-eperm-fail-async');
      mkdirp.sync(dirPath);

      mockFs('readdir', (_p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, files: string[]) => void) => {
        cb(null, ['pending.exe']);
      });
      mockFs('chmod', (_p: fs.PathLike, _mode: fs.Mode, cb: fs.NoParamCallback) => {
        process.nextTick(() => cb(createEPERMError('chmod')));
      });

      let lstatCount = 0;
      const originalLstat = fs.lstat.bind(fs);
      mockFs('lstat', (p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, stats: fs.Stats) => void) => {
        if (p.toString() === dirPath) return originalLstat(p, cb);
        lstatCount++;
        process.nextTick(() => cb(createEPERMError('lstat'), undefined as unknown as fs.Stats));
      });

      fallbackRm(dirPath, { recursive: true, force: true, maxRetries: 2, retryDelay: 1 }, (err) => {
        assert.ok(err);
        assert.equal(err?.code, 'EPERM');
        assert.equal(err?.syscall, 'lstat');
        assert.equal(lstatCount, 3);
        done();
      });
    });

    describe('retry budget is per entry', () => {
      it('should not re-walk the tree when a nested entry fails (async)', (done) => {
        const dirPath = path.join(SUITE_TMP_DIR, 'no-rewalk');
        mkdirp.sync(path.join(dirPath, 'nested'));

        let readdirCount = 0;
        const originalReaddir = fs.readdir.bind(fs);
        mockFs('readdir', (p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, files: string[]) => void) => {
          readdirCount++;
          if (p.toString() === path.join(dirPath, 'nested')) return cb(null, ['stuck.txt']);
          originalReaddir(p, cb);
        });
        const originalLstat = fs.lstat.bind(fs);
        mockFs('lstat', (p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, stats: fs.Stats) => void) => {
          if (p.toString() !== path.join(dirPath, 'nested', 'stuck.txt')) return originalLstat(p, cb);
          process.nextTick(() => cb(createEACCESError(), undefined as unknown as fs.Stats));
        });

        fallbackRm(dirPath, { recursive: true, maxRetries: 3, retryDelay: 1 }, (err) => {
          assert.equal(err?.code, 'EACCES');
          assert.equal(readdirCount, 2);
          done();
        });
      });
    });

    describe('error reporting waits for in-flight entries', () => {
      it('should call back only after every sibling has finished (async)', (done) => {
        const dirPath = path.join(SUITE_TMP_DIR, 'drain');
        mkdirp.sync(dirPath);

        mockFs('readdir', (_p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, files: string[]) => void) => {
          cb(null, ['fast.txt', 'slow.txt']);
        });

        let slowFinished = false;
        const originalLstat = fs.lstat.bind(fs);
        mockFs('lstat', (p: fs.PathLike, cb: (err: NodeJS.ErrnoException | null, stats: fs.Stats) => void) => {
          if (p.toString() === dirPath) return originalLstat(p, cb);
          if (p.toString() === path.join(dirPath, 'fast.txt')) {
            process.nextTick(() => cb(createEACCESError(), undefined as unknown as fs.Stats));
            return;
          }
          setTimeout(() => {
            slowFinished = true;
            cb(createENOENTError(), undefined as unknown as fs.Stats);
          }, 30);
        });

        fallbackRm(dirPath, { recursive: true, force: true }, (err) => {
          assert.equal(err?.code, 'EACCES');
          assert.ok(slowFinished, 'callback fired before the slow sibling finished');
          done();
        });
      });
    });
  });
});
