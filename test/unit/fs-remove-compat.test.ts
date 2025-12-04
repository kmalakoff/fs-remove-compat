import assert from 'assert';
import fs from 'fs';
import { rm, rmSync, safeRm, safeRmSync } from 'fs-remove-compat';
import mkdirp from 'mkdirp-classic';
import path from 'path';
import Pinkie from 'pinkie-promise';
import url from 'url';

const ___filename = typeof __filename !== 'undefined' ? __filename : url.fileURLToPath(import.meta.url);
const ___dirname = path.dirname(___filename);

const TMP_DIR = path.join(___dirname, '..', '..', '.tmp');

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
      // Use our own safeRmSync for cleanup
      safeRmSync(TMP_DIR, { recursive: true, force: true });
    }
  } catch (_e) {
    // ignore
  }
}

function setupTmp(): void {
  cleanTmp();
  mkdirp.sync(TMP_DIR);
}

describe('fs-remove-compat', () => {
  beforeEach(setupTmp);
  after(cleanTmp);

  describe('rmSync', () => {
    it('should remove a file', () => {
      const filePath = path.join(TMP_DIR, 'test-file.txt');
      fs.writeFileSync(filePath, 'content');

      assert.ok(fs.existsSync(filePath), 'file should exist before removal');
      rmSync(filePath);
      assert.ok(!fs.existsSync(filePath), 'file should not exist after removal');
    });

    it('should error when file does not exist', () => {
      const filePath = path.join(TMP_DIR, 'nonexistent.txt');

      try {
        rmSync(filePath);
        assert.fail('should have thrown');
      } catch (err: unknown) {
        assert.equal((err as NodeJS.ErrnoException).code, 'ENOENT');
      }
    });

    it('should not error with force option when file does not exist', () => {
      const filePath = path.join(TMP_DIR, 'nonexistent.txt');

      // Should not throw
      rmSync(filePath, { force: true });
    });

    it('should error when removing directory without recursive', () => {
      const dirPath = path.join(TMP_DIR, 'test-dir');
      mkdirp.sync(dirPath);
      fs.writeFileSync(path.join(dirPath, 'file.txt'), 'content');

      try {
        rmSync(dirPath);
        assert.fail('should have thrown');
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        assert.ok(code === 'EISDIR' || code === 'ERR_FS_EISDIR', `expected EISDIR error, got ${code}`);
      }
    });

    it('should remove directory recursively', () => {
      const dirPath = path.join(TMP_DIR, 'recursive-dir');
      mkdirp.sync(path.join(dirPath, 'subdir'));
      fs.writeFileSync(path.join(dirPath, 'file1.txt'), 'content1');
      fs.writeFileSync(path.join(dirPath, 'subdir', 'file2.txt'), 'content2');

      assert.ok(fs.existsSync(dirPath), 'dir should exist before removal');
      rmSync(dirPath, { recursive: true });
      assert.ok(!fs.existsSync(dirPath), 'dir should not exist after removal');
    });

    it('should remove empty directory with recursive option', () => {
      const dirPath = path.join(TMP_DIR, 'empty-dir');
      mkdirp.sync(dirPath);

      rmSync(dirPath, { recursive: true });
      assert.ok(!fs.existsSync(dirPath), 'dir should not exist after removal');
    });
  });

  describe('rm', () => {
    it('should remove a file (callback style)', (done) => {
      const filePath = path.join(TMP_DIR, 'test-file-cb.txt');
      fs.writeFileSync(filePath, 'content');

      rm(filePath, (err) => {
        if (err) return done(err);
        assert.ok(!fs.existsSync(filePath), 'file should not exist after removal');
        done();
      });
    });

    it('should remove a file (promise style)', async () => {
      const filePath = path.join(TMP_DIR, 'test-file-promise.txt');
      fs.writeFileSync(filePath, 'content');

      await rm(filePath);
      assert.ok(!fs.existsSync(filePath), 'file should not exist after removal');
    });

    it('should error when file does not exist (callback)', (done) => {
      const filePath = path.join(TMP_DIR, 'nonexistent.txt');

      rm(filePath, (err) => {
        assert.ok(err, 'should error');
        assert.equal(err?.code, 'ENOENT');
        done();
      });
    });

    it('should error when file does not exist (promise)', async () => {
      const filePath = path.join(TMP_DIR, 'nonexistent.txt');

      try {
        await rm(filePath);
        assert.fail('should have thrown');
      } catch (err: unknown) {
        assert.equal((err as NodeJS.ErrnoException).code, 'ENOENT');
      }
    });

    it('should not error with force option (promise)', async () => {
      const filePath = path.join(TMP_DIR, 'nonexistent.txt');

      // Should not throw
      await rm(filePath, { force: true });
    });

    it('should remove directory recursively (promise)', async () => {
      const dirPath = path.join(TMP_DIR, 'recursive-promise');
      mkdirp.sync(path.join(dirPath, 'subdir'));
      fs.writeFileSync(path.join(dirPath, 'file1.txt'), 'content1');
      fs.writeFileSync(path.join(dirPath, 'subdir', 'file2.txt'), 'content2');

      await rm(dirPath, { recursive: true });
      assert.ok(!fs.existsSync(dirPath), 'dir should not exist after removal');
    });
  });

  describe('safeRmSync', () => {
    it('should remove a file', () => {
      const filePath = path.join(TMP_DIR, 'safe-file.txt');
      fs.writeFileSync(filePath, 'content');

      safeRmSync(filePath);
      assert.ok(!fs.existsSync(filePath), 'file should not exist after removal');
    });

    it('should remove directory recursively', () => {
      const dirPath = path.join(TMP_DIR, 'safe-recursive');
      mkdirp.sync(path.join(dirPath, 'subdir'));
      fs.writeFileSync(path.join(dirPath, 'file.txt'), 'content');

      safeRmSync(dirPath, { recursive: true });
      assert.ok(!fs.existsSync(dirPath), 'dir should not exist after removal');
    });

    it('should handle force option', () => {
      const filePath = path.join(TMP_DIR, 'nonexistent-safe.txt');

      // Should not throw
      safeRmSync(filePath, { force: true });
    });
  });

  describe('safeRm', () => {
    it('should remove a file (callback style)', (done) => {
      const filePath = path.join(TMP_DIR, 'safe-file-cb.txt');
      fs.writeFileSync(filePath, 'content');

      safeRm(filePath, (err) => {
        if (err) return done(err);
        assert.ok(!fs.existsSync(filePath), 'file should not exist after removal');
        done();
      });
    });

    it('should remove a file (promise style)', async () => {
      const filePath = path.join(TMP_DIR, 'safe-file-promise.txt');
      fs.writeFileSync(filePath, 'content');

      await safeRm(filePath);
      assert.ok(!fs.existsSync(filePath), 'file should not exist after removal');
    });

    it('should remove directory recursively (promise)', async () => {
      const dirPath = path.join(TMP_DIR, 'safe-recursive-promise');
      mkdirp.sync(path.join(dirPath, 'subdir'));
      fs.writeFileSync(path.join(dirPath, 'file.txt'), 'content');

      await safeRm(dirPath, { recursive: true });
      assert.ok(!fs.existsSync(dirPath), 'dir should not exist after removal');
    });

    it('should handle force option (promise)', async () => {
      const filePath = path.join(TMP_DIR, 'nonexistent-safe-promise.txt');

      // Should not throw
      await safeRm(filePath, { force: true });
    });
  });

  describe('symlinks', () => {
    // Skip on Windows due to symlink permissions
    beforeEach(function () {
      if (process.platform === 'win32') return this.skip();
    });

    it('should remove a symlink without removing target', () => {
      const targetPath = path.join(TMP_DIR, 'symlink-target.txt');
      const linkPath = path.join(TMP_DIR, 'symlink.txt');

      fs.writeFileSync(targetPath, 'target content');
      fs.symlinkSync(targetPath, linkPath);

      assert.ok(fs.existsSync(linkPath), 'symlink should exist');
      rmSync(linkPath);
      assert.ok(!fs.existsSync(linkPath), 'symlink should be removed');
      assert.ok(fs.existsSync(targetPath), 'target should still exist');
    });

    it('should remove directory containing symlinks recursively', () => {
      const dirPath = path.join(TMP_DIR, 'dir-with-symlink');
      mkdirp.sync(dirPath);
      fs.writeFileSync(path.join(dirPath, 'target.txt'), 'content');
      fs.symlinkSync('target.txt', path.join(dirPath, 'link.txt'));

      rmSync(dirPath, { recursive: true });
      assert.ok(!fs.existsSync(dirPath), 'dir should be removed');
    });
  });
});
