import assert from 'assert';
import fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import mkdirp from 'mkdirp-classic';
import path from 'path';
import { closeLocks, type FileLock, lockFile } from '../lib/lock.ts';
import { isWindows } from '../lib/platform.ts';
import { errorCode, intact, invalidOptions, options, tree } from '../lib/removal.ts';
import { createScratch, TMP_DIR } from '../lib/scratch.ts';

const { setupTmp, cleanTmp } = createScratch(safeRmSync);

describe('safeRmSync', () => {
  beforeEach(setupTmp);
  after(cleanTmp);
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
    // Should not throw
    safeRmSync(path.join(TMP_DIR, 'nonexistent-safe.txt'), { force: true });
  });
  invalidOptions.forEach((item) => {
    it(`rejects invalid options before mutation: ${JSON.stringify(item.options)}`, () => {
      const root = path.join(TMP_DIR, 'validation');
      tree(root);
      assert.equal(
        errorCode(() => safeRmSync(root, options(item.options))),
        item.code
      );
      intact(root);
    });
  });
  if (isWindows) {
    describe('cleanup with a real Windows lock (windows-latest CI)', () => {
      const locks: FileLock[] = [];
      afterEach((done) => closeLocks(locks, done));
      it('retains cleanup retries when recursive is false', (done) => {
        const file = path.join(TMP_DIR, 'locked');
        fs.writeFileSync(file, 'keep');
        lockFile(file, path.join(TMP_DIR, 'release'), (error, lock) => {
          if (error || !lock) return done(error || new Error('No lock'));
          locks.push(lock);
          assert.throws(() => fs.unlinkSync(file));
          lock.release(400);
          safeRmSync(file, { recursive: false, maxRetries: 4, retryDelay: 200 });
          assert.ok(!fs.existsSync(file));
          done();
        });
      });
    });
  }
});
