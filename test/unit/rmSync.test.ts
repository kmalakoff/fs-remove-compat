import assert from 'assert';
import fs from 'fs';
import { rmSync, safeRmSync } from 'fs-remove-compat';
import mkdirp from 'mkdirp-classic';
import path from 'path';

import { isWindows } from '../lib/platform.ts';
import { createScratch, TMP_DIR } from '../lib/scratch.ts';

const { setupTmp, cleanTmp } = createScratch(safeRmSync);

describe('rmSync', () => {
  beforeEach(setupTmp);
  after(cleanTmp);

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
    // Should not throw
    rmSync(path.join(TMP_DIR, 'nonexistent.txt'), { force: true });
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

  describe('symlinks', () => {
    // Skip on Windows due to symlink permissions
    beforeEach(function () {
      if (isWindows) return this.skip();
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
