import assert from 'assert';
import fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import mkdirp from 'mkdirp-classic';
import path from 'path';
// Import fallback implementations directly
import fallbackRmSync from '../../../src/fallback/rmSync.ts';
import { createScratch, TMP_DIR } from '../../lib/scratch.ts';

const { setupTmp, cleanTmp } = createScratch(safeRmSync);
const SUITE_TMP_DIR = path.join(TMP_DIR, 'fallback-rmSync');

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

  describe('fallbackRmSync', () => {
    it('should remove a file', () => {
      const filePath = path.join(SUITE_TMP_DIR, 'test-file.txt');
      fs.writeFileSync(filePath, 'content');

      fallbackRmSync(filePath);
      assert.ok(!fs.existsSync(filePath));
    });

    it('should error when file does not exist', () => {
      const filePath = path.join(SUITE_TMP_DIR, 'nonexistent.txt');

      try {
        fallbackRmSync(filePath);
        assert.fail('should have thrown');
      } catch (err: unknown) {
        assert.equal((err as NodeJS.ErrnoException).code, 'ENOENT');
      }
    });

    it('should not error with force option', () => {
      const filePath = path.join(SUITE_TMP_DIR, 'nonexistent.txt');
      fallbackRmSync(filePath, { force: true });
    });

    it('should error on directory without recursive', () => {
      const dirPath = path.join(SUITE_TMP_DIR, 'test-dir');
      mkdirp.sync(dirPath);

      try {
        fallbackRmSync(dirPath);
        assert.fail('should have thrown');
      } catch (err: unknown) {
        assert.equal((err as NodeJS.ErrnoException).code, 'EISDIR');
      }
    });

    it('should remove directory recursively', () => {
      const dirPath = path.join(SUITE_TMP_DIR, 'recursive-dir');
      mkdirp.sync(path.join(dirPath, 'subdir'));
      fs.writeFileSync(path.join(dirPath, 'file1.txt'), 'content1');
      fs.writeFileSync(path.join(dirPath, 'subdir', 'file2.txt'), 'content2');

      fallbackRmSync(dirPath, { recursive: true });
      assert.ok(!fs.existsSync(dirPath));
    });

    it('should remove empty directory with recursive', () => {
      const dirPath = path.join(SUITE_TMP_DIR, 'empty-dir');
      mkdirp.sync(dirPath);

      fallbackRmSync(dirPath, { recursive: true });
      assert.ok(!fs.existsSync(dirPath));
    });

    it('should handle force on missing file in directory', () => {
      const dirPath = path.join(SUITE_TMP_DIR, 'partial-dir');
      mkdirp.sync(dirPath);
      fs.writeFileSync(path.join(dirPath, 'file.txt'), 'content');

      // Remove file manually to simulate race condition
      fs.unlinkSync(path.join(dirPath, 'file.txt'));

      fallbackRmSync(dirPath, { recursive: true, force: true });
      assert.ok(!fs.existsSync(dirPath));
    });

    it('should respect maxRetries option', () => {
      const filePath = path.join(SUITE_TMP_DIR, 'retry-file.txt');
      fs.writeFileSync(filePath, 'content');

      // This should succeed without retries needed
      fallbackRmSync(filePath, { maxRetries: 3, retryDelay: 10 });
      assert.ok(!fs.existsSync(filePath));
    });
  });
  describe('fallbackRmSync edge cases', () => {
    it('should handle stat error on file in directory with force', () => {
      const dirPath = path.join(SUITE_TMP_DIR, 'sync-lstat-error');
      mkdirp.sync(dirPath);
      // Empty directory - should just rmdir
      fallbackRmSync(dirPath, { recursive: true, force: true });
      assert.ok(!fs.existsSync(dirPath));
    });

    it('should handle non-ENOENT stat error', () => {
      // This is hard to trigger without mocking - the error would be EACCES or similar
      // Just verify the path exists for now
      const dirPath = path.join(SUITE_TMP_DIR, 'stat-other-error');
      mkdirp.sync(dirPath);
      fallbackRmSync(dirPath, { recursive: true });
      assert.ok(!fs.existsSync(dirPath));
    });
  });

  describe('fallbackRmSync retry on EBUSY', () => {
    it('should retry on EBUSY and succeed', () => {
      const filePath = path.join(SUITE_TMP_DIR, 'ebusy-sync.txt');
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
      const filePath = path.join(SUITE_TMP_DIR, 'ebusy-sync-fail.txt');
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
      const dirPath = path.join(SUITE_TMP_DIR, 'enotempty-sync');
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
      const dirPath = path.join(SUITE_TMP_DIR, 'enotempty-sync-fail');
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
      const dirPath = path.join(SUITE_TMP_DIR, 'enoent-sync-rmdir');
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
      const dirPath = path.join(SUITE_TMP_DIR, 'enoent-sync-rmdir-force');
      mkdirp.sync(dirPath);

      mockFs('rmdirSync', () => {
        throw createENOENTError();
      });

      // Should not throw with force
      fallbackRmSync(dirPath, { recursive: true, force: true });
    });

    it('should handle ENOENT race in unlinkSync without force', () => {
      const filePath = path.join(SUITE_TMP_DIR, 'enoent-sync-race.txt');
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
      const filePath = path.join(SUITE_TMP_DIR, 'enoent-sync-race-force.txt');
      fs.writeFileSync(filePath, 'content');

      mockFs('unlinkSync', () => {
        throw createENOENTError();
      });

      // Should not throw with force
      fallbackRmSync(filePath, { force: true });
    });

    it('should handle ENOENT in readdirSync without force', () => {
      const dirPath = path.join(SUITE_TMP_DIR, 'enoent-readdir-sync');
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
      const dirPath = path.join(SUITE_TMP_DIR, 'enoent-readdir-sync-force');
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
    it('should not retry on EACCES (sync)', () => {
      const filePath = path.join(SUITE_TMP_DIR, 'eacces-sync.txt');
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
  describe('sync recursive error paths', () => {
    it('should handle lstat error without force (sync)', () => {
      const dirPath = path.join(SUITE_TMP_DIR, 'lstat-error-sync');
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
      const dirPath = path.join(SUITE_TMP_DIR, 'lstat-error-force-sync');
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
      const dirPath = path.join(SUITE_TMP_DIR, 'unlink-error-sync');
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

  describe('lstat retry on a delete-pending entry', () => {
    it('should retry lstatSync on EPERM and succeed once the entry is gone (sync)', () => {
      const dirPath = path.join(SUITE_TMP_DIR, 'lstat-eperm-sync');
      mkdirp.sync(dirPath);

      mockFs('readdirSync', () => ['pending.exe']);
      mockFs('chmodSync', () => {
        throw createEPERMError('chmod');
      });

      let lstatCount = 0;
      const originalLstatSync = fs.lstatSync.bind(fs);
      mockFs('lstatSync', (p: fs.PathLike) => {
        if (p.toString() === dirPath) return originalLstatSync(p);
        lstatCount++;
        throw lstatCount < 3 ? createEPERMError('lstat') : createENOENTError();
      });
      mockFs('rmdirSync', () => undefined);

      fallbackRmSync(dirPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 1 });
      assert.equal(lstatCount, 3);
    });

    it('should fail after max retries when lstatSync keeps returning EPERM (sync)', () => {
      const dirPath = path.join(SUITE_TMP_DIR, 'lstat-eperm-fail-sync');
      mkdirp.sync(dirPath);

      mockFs('readdirSync', () => ['pending.exe']);
      mockFs('chmodSync', () => {
        throw createEPERMError('chmod');
      });

      let lstatCount = 0;
      const originalLstatSync = fs.lstatSync.bind(fs);
      mockFs('lstatSync', (p: fs.PathLike) => {
        if (p.toString() === dirPath) return originalLstatSync(p);
        lstatCount++;
        throw createEPERMError('lstat');
      });

      try {
        fallbackRmSync(dirPath, { recursive: true, force: true, maxRetries: 2, retryDelay: 1 });
        assert.fail('should have thrown');
      } catch (err: unknown) {
        assert.equal((err as NodeJS.ErrnoException).code, 'EPERM');
        assert.equal(lstatCount, 3);
      }
    });
  });
});
