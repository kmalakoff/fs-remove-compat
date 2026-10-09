import assert from 'assert';
import fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import mkdirp from 'mkdirp-classic';
import path from 'path';
import url from 'url';
import fallbackRmSync from '../../../src/fallback/rmSync.ts';
import { HAS_BUFFER_PATHS, toBuffer } from '../../../src/lib/path.ts';
import { closeLocks, type FileLock, lockFile } from '../../lib/lock.ts';
import { isWindows } from '../../lib/platform.ts';
import { errorCode, intact, invalidOptions, nativeRmSync, options, tree } from '../../lib/removal.ts';
import { createScratch, TMP_DIR } from '../../lib/scratch.ts';

const { setupTmp, cleanTmp } = createScratch(safeRmSync);
const root = path.join(TMP_DIR, 'fallback-sync');

describe('fallbackRmSync', () => {
  beforeEach(setupTmp);
  after(cleanTmp);

  it('removes files and nested directories', () => {
    tree(root);
    fallbackRmSync(path.join(root, 'child', 'keep.txt'));
    assert.ok(!fs.existsSync(path.join(root, 'child', 'keep.txt')));
    fallbackRmSync(root, { recursive: true });
    assert.ok(!fs.existsSync(root));
  });

  it('reports missing paths and suppresses only ENOENT with force', () => {
    assert.equal(
      errorCode(() => fallbackRmSync(root)),
      'ENOENT'
    );
    fallbackRmSync(root, { force: true });
    fs.writeFileSync(root, 'file');
    const child = path.join(root, 'child');
    const nativeCode = errorCode(() => fs.lstatSync(child));
    assert.ok(nativeCode === 'ENOENT' || nativeCode === 'ENOTDIR');
    if (!isWindows) assert.equal(nativeCode, 'ENOTDIR');
    assert.equal(
      errorCode(() => fallbackRmSync(child)),
      nativeCode
    );
    assert.equal(
      errorCode(() => fallbackRmSync(child, { force: true })),
      nativeCode === 'ENOENT' ? undefined : nativeCode
    );
    assert.equal(fs.readFileSync(root, 'utf8'), 'file');
  });

  it('reports ERR_FS_EISDIR and preserves the directory with and without force', () => {
    tree(root);
    for (const force of [false, true]) {
      let error: NodeJS.ErrnoException | undefined;
      try {
        fallbackRmSync(root, { force });
      } catch (err) {
        error = err as NodeJS.ErrnoException;
      }
      assert.ok(error);
      assert.equal(error?.code, 'ERR_FS_EISDIR');
      assert.equal(error?.name, 'SystemError');
      assert.equal(error?.syscall, 'rm');
      assert.equal(error?.path, root);
      intact(root);
    }
  });

  invalidOptions.forEach((item) => {
    it(`rejects invalid options before mutation: ${JSON.stringify(item.options)}`, () => {
      tree(root);
      assert.equal(
        errorCode(() => fallbackRmSync(root, options(item.options))),
        item.code
      );
      intact(root);
    });
  });

  it('rejects invalid paths even with force', () => {
    for (const value of [null, 1, {}, true]) {
      assert.equal(
        errorCode(() => fallbackRmSync(value as unknown as string, { force: true })),
        'ERR_INVALID_ARG_TYPE'
      );
    }
    assert.equal(
      errorCode(() => fallbackRmSync(`${root}\0`, { force: true })),
      'ERR_INVALID_ARG_VALUE'
    );
    assert.equal(
      errorCode(() => fallbackRmSync(toBuffer(`${root}\0`), { force: true })),
      'ERR_INVALID_ARG_VALUE'
    );
  });

  it('removes a Buffer directory path recursively', () => {
    tree(root);
    fallbackRmSync(toBuffer(root), { recursive: true });
    assert.ok(!fs.existsSync(root));
  });

  if (typeof url.URL === 'function') {
    it('removes a file URL directory recursively', () => {
      tree(root);
      fallbackRmSync(new url.URL(`file://${isWindows ? '/' : ''}${root.replace(/\\/g, '/')}`), { recursive: true });
      assert.ok(!fs.existsSync(root));
    });
    it('rejects non-file URLs without mutation', () => {
      tree(root);
      assert.equal(
        errorCode(() => fallbackRmSync(new url.URL('https://example.com/'))),
        'ERR_INVALID_URL_SCHEME'
      );
      intact(root);
    });
  }

  it('removes directory symlinks and broken links without following their targets', () => {
    tree(root);
    const link = path.join(TMP_DIR, 'link');
    fs.symlinkSync(root, link, isWindows ? 'junction' : 'dir');
    fallbackRmSync(link, { recursive: true });
    assert.equal(
      errorCode(() => fs.lstatSync(link)),
      'ENOENT'
    );
    intact(root);
    fs.symlinkSync(path.join(TMP_DIR, 'missing'), link, isWindows ? 'junction' : 'dir');
    fallbackRmSync(link);
    assert.equal(
      errorCode(() => fs.lstatSync(link)),
      'ENOENT'
    );
  });

  if (HAS_BUFFER_PATHS && process.platform === 'linux') {
    it('preserves non-UTF8 directory entry bytes', () => {
      mkdirp.sync(root);
      const raw = Buffer.concat([toBuffer(`${root}/`), toBuffer('x')]);
      raw[raw.length - 1] = 255;
      fs.writeFileSync(raw, 'bytes');
      fallbackRmSync(toBuffer(root), { recursive: true });
      assert.ok(!fs.existsSync(root));
    });
  }

  if (nativeRmSync) {
    const oracleRmSync = nativeRmSync;
    it('matches native option errors on real directories without deleting their contents', () => {
      const oracle = path.join(TMP_DIR, 'native');
      tree(root);
      tree(oracle);
      invalidOptions
        .filter((item) => !Array.isArray(item.options))
        .forEach((item) => {
          assert.equal(
            errorCode(() => fallbackRmSync(root, options(item.options))),
            errorCode(() => oracleRmSync(oracle, options(item.options)))
          );
          intact(root);
          intact(oracle);
        });
      assert.equal(
        errorCode(() => fallbackRmSync(root)),
        errorCode(() => oracleRmSync(oracle))
      );
      oracleRmSync(oracle, { recursive: true });
      fallbackRmSync(root, { recursive: true });
      assert.ok(!fs.existsSync(oracle));
      assert.ok(!fs.existsSync(root));
    });
  }
  if (isWindows) {
    describe('real Windows locks (windows-latest CI)', () => {
      const locks: FileLock[] = [];
      afterEach((done) => closeLocks(locks, done));
      it('retries until another process releases an exclusive handle', (done) => {
        fs.writeFileSync(root, 'locked');
        lockFile(root, path.join(TMP_DIR, 'release'), (error, lock) => {
          if (error || !lock) return done(error || new Error('No lock'));
          locks.push(lock);
          assert.throws(() => fs.unlinkSync(root));
          lock.release(400);
          fallbackRmSync(root, { recursive: true, maxRetries: 4, retryDelay: 200 });
          assert.ok(!fs.existsSync(root));
          done();
        });
      });
      it('exhausts retries on a permanently held entry in a deep directory', (done) => {
        tree(root);
        const file = path.join(root, 'child', 'keep.txt');
        lockFile(file, path.join(TMP_DIR, 'release'), (error, lock) => {
          if (error || !lock) return done(error || new Error('No lock'));
          locks.push(lock);
          assert.throws(() => fs.unlinkSync(file));
          const start = Date.now();
          assert.throws(() => fallbackRmSync(root, { recursive: true, maxRetries: 2, retryDelay: 100 }));
          assert.ok(Date.now() - start >= 300, 'Two retries must wait 100 + 200ms');
          assert.deepEqual(fs.readdirSync(path.join(root, 'child')), ['keep.txt']);
          done();
        });
      });
    });
  }
});
