import assert from 'assert';
import fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import path from 'path';
import url from 'url';
import fallbackRm from '../../../src/fallback/rm.ts';
import { HAS_BUFFER_PATHS, toBuffer } from '../../../src/lib/path.ts';
import type { RmCallback } from '../../../src/types.ts';
import { closeLocks, type FileLock, lockFile } from '../../lib/lock.ts';
import { isWindows } from '../../lib/platform.ts';
import { errorCode, HAS_POSIX_PERMISSIONS, intact, invalidOptions, nativeRm, options, tree } from '../../lib/removal.ts';
import { createScratch, TMP_DIR } from '../../lib/scratch.ts';

const { setupTmp, cleanTmp } = createScratch(safeRmSync);
const root = path.join(TMP_DIR, 'fallback-async');

describe('fallbackRm', () => {
  beforeEach(setupTmp);
  after(cleanTmp);

  it('removes nested directories before calling back', (done) => {
    tree(root);
    let synchronous = true;
    fallbackRm(root, { recursive: true }, (error) => {
      if (error) return done(error);
      assert.equal(synchronous, false);
      assert.ok(!fs.existsSync(root));
      done();
    });
    synchronous = false;
  });

  it('removes a file without recursive', (done) => {
    fs.writeFileSync(root, 'file');
    fallbackRm(root, undefined, (error) => {
      if (error) return done(error);
      assert.ok(!fs.existsSync(root));
      done();
    });
  });

  it('reports missing paths asynchronously', (done) => {
    let synchronous = true;
    fallbackRm(root, undefined, (error) => {
      assert.equal(synchronous, false);
      assert.equal(error?.code, 'ENOENT');
      done();
    });
    synchronous = false;
  });

  it('succeeds with force on a missing path', (done) => {
    fallbackRm(root, { force: true }, (error) => {
      assert.ok(!error);
      done();
    });
  });

  for (const force of [false, true]) {
    it(`matches native lstat errors for a child of a file with force=${force}`, (done) => {
      fs.writeFileSync(root, 'file');
      const child = path.join(root, 'child');
      fs.lstat(child, (nativeError) => {
        const nativeCode = nativeError?.code;
        assert.ok(nativeCode === 'ENOENT' || nativeCode === 'ENOTDIR');
        if (!isWindows) assert.equal(nativeCode, 'ENOTDIR');
        fallbackRm(child, { force }, (error) => {
          assert.equal(error?.code, force && nativeCode === 'ENOENT' ? undefined : nativeCode);
          assert.equal(fs.readFileSync(root, 'utf8'), 'file');
          done();
        });
      });
    });
  }

  for (const force of [true, false]) {
    it(`preserves directories without recursive with force=${force}`, (done) => {
      tree(root);
      fallbackRm(root, { force }, (error) => {
        assert.equal(error?.code, 'ERR_FS_EISDIR');
        assert.equal(error?.name, 'SystemError');
        assert.equal(error?.path, root);
        assert.equal(error?.syscall, 'rm');
        intact(root);
        done();
      });
    });
  }

  invalidOptions.forEach((item) => {
    it(`throws for invalid options before mutation: ${JSON.stringify(item.options)}`, () => {
      tree(root);
      assert.equal(
        errorCode(() => fallbackRm(root, options(item.options), () => assert.fail('callback must not run'))),
        item.code
      );
      intact(root);
    });
  });

  it('rejects invalid callbacks before touching a file', () => {
    fs.writeFileSync(root, 'keep');
    for (const callback of [null, undefined, 1, {}]) {
      assert.equal(
        errorCode(() => fallbackRm(root, undefined, callback as RmCallback)),
        'ERR_INVALID_ARG_TYPE'
      );
      assert.equal(fs.readFileSync(root, 'utf8'), 'keep');
    }
  });

  it('rejects invalid and null-byte paths synchronously with force', () => {
    for (const value of [null, 1, {}, true]) {
      assert.equal(
        errorCode(() => fallbackRm(value as unknown as string, { force: true }, () => assert.fail('callback'))),
        'ERR_INVALID_ARG_TYPE'
      );
    }
    assert.equal(
      errorCode(() => fallbackRm(toBuffer(`${root}\0`), { force: true }, () => assert.fail('callback'))),
      'ERR_INVALID_ARG_VALUE'
    );
  });

  it('removes a Buffer directory recursively', (done) => {
    tree(root);
    fallbackRm(toBuffer(root), { recursive: true }, (error) => {
      if (error) return done(error);
      assert.ok(!fs.existsSync(root));
      done();
    });
  });

  if (typeof url.URL === 'function') {
    it('removes a file URL directory recursively', (done) => {
      tree(root);
      fallbackRm(new url.URL(`file://${isWindows ? '/' : ''}${root.replace(/\\/g, '/')}`), { recursive: true }, (error) => {
        if (error) return done(error);
        assert.ok(!fs.existsSync(root));
        done();
      });
    });
  }

  it('unlinks directory symlinks without following targets', (done) => {
    tree(root);
    const link = path.join(TMP_DIR, 'link');
    fs.symlinkSync(root, link, isWindows ? 'junction' : 'dir');
    fallbackRm(link, { recursive: true }, (error) => {
      if (error) return done(error);
      assert.equal(
        errorCode(() => fs.lstatSync(link)),
        'ENOENT'
      );
      intact(root);
      done();
    });
  });

  if (nativeRm) {
    const oracleRm = nativeRm;
    it('matches native synchronous option rejection before touching real directories', () => {
      const oracle = path.join(TMP_DIR, 'native');
      tree(root);
      tree(oracle);
      invalidOptions
        .filter((item) => !Array.isArray(item.options))
        .forEach((item) => {
          assert.equal(
            errorCode(() => fallbackRm(root, options(item.options), () => assert.fail('callback'))),
            errorCode(() => oracleRm(oracle, options(item.options), () => assert.fail('callback')))
          );
          intact(root);
          intact(oracle);
        });
    });

    it('matches native asynchronous directory rejection and preserves both trees', (done) => {
      const oracle = path.join(TMP_DIR, 'native');
      tree(root);
      tree(oracle);
      oracleRm(oracle, {}, (nativeError) => {
        fallbackRm(root, undefined, (error) => {
          assert.equal(error?.code, nativeError?.code);
          assert.equal(error?.name, nativeError?.name);
          assert.equal(error?.errno, nativeError?.errno);
          assert.equal(error?.syscall, nativeError?.syscall);
          intact(root);
          intact(oracle);
          done();
        });
      });
    });
  }
  if (HAS_BUFFER_PATHS && process.platform === 'linux') {
    it('removes raw non-UTF8 entries before calling back', (done) => {
      tree(root);
      const raw = Buffer.concat([toBuffer(`${root}/`), toBuffer('x')]);
      raw[raw.length - 1] = 255;
      fs.writeFileSync(raw, 'bytes');
      fallbackRm(toBuffer(root), { recursive: true }, (error) => {
        if (error) return done(error);
        assert.ok(!fs.existsSync(root));
        done();
      });
    });
  }

  // ubuntu-latest CI runs this strictly as a non-root POSIX user.
  if (process.env.CI && process.platform === 'linux') {
    it('has the POSIX permission capability required by Linux CI', () => assert.ok(HAS_POSIX_PERMISSIONS, 'Run Linux CI without root privileges'));
  }
  if (HAS_POSIX_PERMISSIONS) {
    it('reports a real readdir failure after all removable siblings have drained', (done) => {
      tree(root);
      const blocked = path.join(root, 'child');
      for (let i = 0; i < 128; i++) fs.writeFileSync(path.join(root, `sibling-${i}`), 'remove');
      fs.chmodSync(blocked, 0);
      try {
        assert.throws(
          () => fs.readdirSync(blocked),
          (error: unknown) => (error as NodeJS.ErrnoException).code === 'EACCES'
        );
      } catch (error) {
        fs.chmodSync(blocked, 0o755);
        throw error;
      }
      fallbackRm(root, { recursive: true, force: true }, (error) => {
        fs.chmodSync(blocked, 0o755);
        assert.equal(error?.code, 'EACCES');
        assert.deepEqual(fs.readdirSync(root), ['child']);
        intact(root);
        done();
      });
    });
  }

  if (isWindows) {
    describe('real Windows locks (windows-latest CI)', () => {
      const locks: FileLock[] = [];
      afterEach((done) => closeLocks(locks, done));

      it('retries an exclusive file handle and succeeds after release', (done) => {
        fs.writeFileSync(root, 'locked');
        lockFile(root, path.join(TMP_DIR, 'release'), (error, lock) => {
          if (error || !lock) return done(error || new Error('No lock'));
          locks.push(lock);
          assert.throws(() => fs.unlinkSync(root));
          lock.release(400);
          fallbackRm(root, { recursive: true, maxRetries: 4, retryDelay: 200 }, (removeError) => {
            if (removeError) return done(removeError);
            assert.ok(!fs.existsSync(root));
            done();
          });
        });
      });

      it('exhausts the per-entry retry budget in a deep tree and drains siblings', (done) => {
        tree(root);
        const file = path.join(root, 'child', 'keep.txt');
        fs.writeFileSync(path.join(root, 'sibling'), 'remove');
        lockFile(file, path.join(TMP_DIR, 'release'), (error, lock) => {
          if (error || !lock) return done(error || new Error('No lock'));
          locks.push(lock);
          assert.throws(() => fs.unlinkSync(file));
          const start = Date.now();
          fallbackRm(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }, (removeError) => {
            assert.ok(removeError);
            assert.ok(Date.now() - start >= 300, 'Two retries must wait 100 + 200ms');
            assert.deepEqual(fs.readdirSync(root), ['child']);
            assert.deepEqual(fs.readdirSync(path.join(root, 'child')), ['keep.txt']);
            done();
          });
        });
      });
    });
  }
});
