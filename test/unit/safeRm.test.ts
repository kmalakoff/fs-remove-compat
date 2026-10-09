import assert from 'assert';
import fs from 'fs';
import { safeRm, safeRmSync } from 'fs-remove-compat';
import mkdirp from 'mkdirp-classic';
import path from 'path';

import type { RmCallback } from '../../src/types.ts';
import { closeLocks, type FileLock, lockFile } from '../lib/lock.ts';
import { isWindows } from '../lib/platform.ts';
import { errorCode, HAS_POSIX_PERMISSIONS, intact, invalidOptions, options, tree } from '../lib/removal.ts';
import { createScratch, TMP_DIR } from '../lib/scratch.ts';

const { setupTmp, cleanTmp } = createScratch(safeRmSync);

describe('safeRm', () => {
  beforeEach(setupTmp);
  after(cleanTmp);
  it('should remove a file (callback style)', (done) => {
    const filePath = path.join(TMP_DIR, 'safe-file-cb.txt');
    fs.writeFileSync(filePath, 'content');
    safeRm(filePath, (err) => {
      if (err) return done(err);
      assert.ok(!fs.existsSync(filePath), 'file should not exist after removal');
      done();
    });
  });
  it('should remove directory recursively (callback)', (done) => {
    const dirPath = path.join(TMP_DIR, 'safe-recursive-cb');
    mkdirp.sync(path.join(dirPath, 'subdir'));
    fs.writeFileSync(path.join(dirPath, 'file.txt'), 'content');
    safeRm(dirPath, { recursive: true }, (err) => {
      if (err) return done(err);
      assert.ok(!fs.existsSync(dirPath), 'dir should not exist after removal');
      done();
    });
  });
  it('should handle force option (callback)', (done) => {
    safeRm(path.join(TMP_DIR, 'nonexistent-safe-cb.txt'), { force: true }, (err) => {
      assert.ok(!err);
      done();
    });
  });
  invalidOptions.forEach((item) => {
    it(`rejects invalid options before mutation: ${JSON.stringify(item.options)}`, () => {
      const root = path.join(TMP_DIR, 'validation');
      tree(root);
      assert.equal(
        errorCode(() => safeRm(root, options(item.options), () => assert.fail('callback must not run'))),
        item.code
      );
      intact(root);
    });
  });

  it('rejects invalid callbacks before mutation', () => {
    const file = path.join(TMP_DIR, 'callback');
    fs.writeFileSync(file, 'keep');
    for (const value of [null, undefined, 1, {}]) {
      assert.equal(
        errorCode(() => safeRm(file, {}, value as RmCallback)),
        'ERR_INVALID_ARG_TYPE'
      );
      assert.equal(fs.readFileSync(file, 'utf8'), 'keep');
    }
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
          safeRm(file, { recursive: false, maxRetries: 4, retryDelay: 200 }, (removeError) => {
            if (removeError) return done(removeError);
            assert.ok(!fs.existsSync(file));
            done();
          });
        });
      });
    });
  }

  if (HAS_POSIX_PERMISSIONS) {
    it('waits for every removable sibling before reporting a real permission failure', (done) => {
      const root = path.join(TMP_DIR, 'drain');
      tree(root);
      const blocked = path.join(root, 'child');
      for (let i = 0; i < 128; i++) fs.writeFileSync(path.join(root, `sibling-${i}`), 'remove');
      fs.chmodSync(blocked, 0);
      safeRm(root, (error) => {
        fs.chmodSync(blocked, 0o755);
        assert.equal(error?.code, 'EACCES');
        assert.deepEqual(fs.readdirSync(root), ['child']);
        intact(root);
        done();
      });
    });
  }
});
