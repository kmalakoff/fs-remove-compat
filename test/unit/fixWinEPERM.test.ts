import assert from 'assert';
import fs from 'fs';
import mkdirp from 'mkdirp-classic';
import path from 'path';
import Pinkie from 'pinkie-promise';
import url from 'url';

// Import fixWinEPERM utilities directly
import { fixWinEPERM, fixWinEPERMSync, shouldFixEPERM } from '../../src/fallback/fixWinEPERM.ts';

const ___filename = typeof __filename !== 'undefined' ? __filename : url.fileURLToPath(import.meta.url);
const ___dirname = path.dirname(___filename);
const isWindows = process.platform === 'win32' || /^(msys|cygwin)$/.test(process.env.OSTYPE);

const TMP_DIR = path.join(___dirname, '..', '..', '.tmp', 'eperm-test');

// Patch global Promise for Node 0.8 compatibility
(() => {
  if (typeof global === 'undefined') return;
  const globalPromise = (global as typeof globalThis & { Promise?: typeof Promise }).Promise;
  before(() => {
    (global as typeof globalThis & { Promise: typeof Promise }).Promise = Pinkie;
  });
  after(() => {
    (global as typeof globalThis & { Promise?: typeof Promise }).Promise = globalPromise;
  });
})();

function cleanTmp(): void {
  try {
    if (fs.existsSync(TMP_DIR)) {
      // Manual recursive removal
      const removeRecursive = (p: string) => {
        if (fs.statSync(p).isDirectory()) {
          const entries = fs.readdirSync(p);
          for (let i = 0; i < entries.length; i++) {
            removeRecursive(path.join(p, entries[i]));
          }
          fs.rmdirSync(p);
        } else {
          fs.unlinkSync(p);
        }
      };
      removeRecursive(TMP_DIR);
    }
  } catch (_e) {
    // ignore
  }
}

function setupTmp(): void {
  cleanTmp();
  mkdirp.sync(TMP_DIR);
}

describe('fixWinEPERM utilities', () => {
  beforeEach(setupTmp);
  after(cleanTmp);

  describe('shouldFixEPERM', () => {
    it('should return true for EPERM on Windows', () => {
      const err = new Error('EPERM') as NodeJS.ErrnoException;
      err.code = 'EPERM';

      if (isWindows) {
        assert.equal(shouldFixEPERM(err), true);
      } else {
        // On non-Windows, should always return false
        assert.equal(shouldFixEPERM(err), false);
      }
    });

    it('should return false for non-EPERM errors', () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      assert.equal(shouldFixEPERM(err), false);
    });

    it('should return false for EBUSY', () => {
      const err = new Error('EBUSY') as NodeJS.ErrnoException;
      err.code = 'EBUSY';
      assert.equal(shouldFixEPERM(err), false);
    });
  });

  describe('fixWinEPERMSync', () => {
    it('should remove a file after chmod', () => {
      const filePath = path.join(TMP_DIR, 'test-file.txt');
      fs.writeFileSync(filePath, 'content');

      const originalError = new Error('EPERM') as NodeJS.ErrnoException;
      originalError.code = 'EPERM';

      fixWinEPERMSync(filePath, originalError);
      assert.ok(!fs.existsSync(filePath));
    });

    it('should remove a directory after chmod', () => {
      const dirPath = path.join(TMP_DIR, 'test-dir');
      mkdirp.sync(dirPath);

      const originalError = new Error('EPERM') as NodeJS.ErrnoException;
      originalError.code = 'EPERM';

      fixWinEPERMSync(dirPath, originalError);
      assert.ok(!fs.existsSync(dirPath));
    });

    it('should throw original error if chmod fails', () => {
      const filePath = path.join(TMP_DIR, 'nonexistent.txt');
      const originalError = new Error('EPERM: original') as NodeJS.ErrnoException;
      originalError.code = 'EPERM';

      try {
        fixWinEPERMSync(filePath, originalError);
        assert.fail('should have thrown');
      } catch (err: unknown) {
        assert.equal((err as Error).message, 'EPERM: original');
      }
    });

    it('should throw original error if stat fails after chmod', () => {
      const filePath = path.join(TMP_DIR, 'stat-fail.txt');
      fs.writeFileSync(filePath, 'content');

      const originalError = new Error('EPERM: original') as NodeJS.ErrnoException;
      originalError.code = 'EPERM';

      // Remove the file after chmod would succeed but before stat
      fs.unlinkSync(filePath);

      try {
        fixWinEPERMSync(filePath, originalError);
        assert.fail('should have thrown');
      } catch (err: unknown) {
        assert.equal((err as Error).message, 'EPERM: original');
      }
    });
  });

  describe('fixWinEPERM', () => {
    it('should remove a file after chmod (callback)', (done) => {
      const filePath = path.join(TMP_DIR, 'test-file-cb.txt');
      fs.writeFileSync(filePath, 'content');

      const originalError = new Error('EPERM') as NodeJS.ErrnoException;
      originalError.code = 'EPERM';

      fixWinEPERM(filePath, originalError, (err) => {
        if (err) return done(err);
        assert.ok(!fs.existsSync(filePath));
        done();
      });
    });

    it('should remove a directory after chmod (callback)', (done) => {
      const dirPath = path.join(TMP_DIR, 'test-dir-cb');
      mkdirp.sync(dirPath);

      const originalError = new Error('EPERM') as NodeJS.ErrnoException;
      originalError.code = 'EPERM';

      fixWinEPERM(dirPath, originalError, (err) => {
        if (err) return done(err);
        assert.ok(!fs.existsSync(dirPath));
        done();
      });
    });

    it('should return original error if chmod fails (callback)', (done) => {
      const filePath = path.join(TMP_DIR, 'nonexistent-cb.txt');
      const originalError = new Error('EPERM: original') as NodeJS.ErrnoException;
      originalError.code = 'EPERM';

      fixWinEPERM(filePath, originalError, (err) => {
        assert.ok(err);
        assert.equal(err?.message, 'EPERM: original');
        done();
      });
    });

    it('should return original error if stat fails after chmod (callback)', (done) => {
      const filePath = path.join(TMP_DIR, 'stat-fail-cb.txt');
      fs.writeFileSync(filePath, 'content');

      const originalError = new Error('EPERM: original') as NodeJS.ErrnoException;
      originalError.code = 'EPERM';

      // Remove the file after chmod - we need to do this in the callback chain
      // So we create a file, then immediately remove it to trigger the stat failure
      fs.unlinkSync(filePath);

      fixWinEPERM(filePath, originalError, (err) => {
        assert.ok(err);
        assert.equal(err?.message, 'EPERM: original');
        done();
      });
    });
  });
});
