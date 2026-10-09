import assert from 'assert';
import fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import mkdirp from 'mkdirp-classic';
import path from 'path';
import { fixWinEPERM, fixWinEPERMSync, shouldFixEPERM } from '../../../src/fallback/fixWinEPERM.ts';
import { isWindows } from '../../lib/platform.ts';
import { createScratch, TMP_DIR } from '../../lib/scratch.ts';

const { setupTmp, cleanTmp } = createScratch(safeRmSync);
const root = path.join(TMP_DIR, 'fix-eperm');

function originalError(): NodeJS.ErrnoException {
  try {
    fs.unlinkSync(path.join(TMP_DIR, 'missing'));
  } catch (error) {
    return error as NodeJS.ErrnoException;
  }
  throw new Error('Expected the operating system to reject removal of a missing file');
}

describe('fixWinEPERM', () => {
  beforeEach(setupTmp);
  after(cleanTmp);

  it('does not select a real ENOENT error for permission repair', () => {
    assert.equal(shouldFixEPERM(originalError()), false);
  });

  it('clears file permissions and removes the file synchronously', () => {
    fs.writeFileSync(root, 'file');
    fs.chmodSync(root, 0o444);
    fixWinEPERMSync(root, originalError());
    assert.ok(!fs.existsSync(root));
  });

  it('clears file permissions and removes the file asynchronously', (done) => {
    fs.writeFileSync(root, 'file');
    fs.chmodSync(root, 0o444);
    fixWinEPERM(root, originalError(), (error) => {
      if (error) return done(error);
      assert.ok(!fs.existsSync(root));
      done();
    });
  });

  it('removes an empty directory synchronously', () => {
    mkdirp.sync(root);
    fixWinEPERMSync(root, originalError());
    assert.ok(!fs.existsSync(root));
  });

  it('removes an empty directory asynchronously', (done) => {
    mkdirp.sync(root);
    fixWinEPERM(root, originalError(), (error) => {
      if (error) return done(error);
      assert.ok(!fs.existsSync(root));
      done();
    });
  });

  it('preserves the original error identity when chmod fails synchronously', () => {
    const original = originalError();
    assert.throws(
      () => fixWinEPERMSync(root, original),
      (error: unknown) => error === original
    );
  });

  it('preserves the original error identity when chmod fails asynchronously', (done) => {
    const original = originalError();
    fixWinEPERM(root, original, (error) => {
      assert.equal(error, original);
      done();
    });
  });

  it('propagates a real nonempty-directory removal error', () => {
    mkdirp.sync(root);
    fs.writeFileSync(path.join(root, 'keep'), 'keep');
    try {
      assert.throws(
        () => fixWinEPERMSync(root, originalError()),
        (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOTEMPTY'
      );
    } finally {
      fs.chmodSync(root, 0o755);
    }
    assert.equal(fs.readFileSync(path.join(root, 'keep'), 'utf8'), 'keep');
  });

  it('propagates a real nonempty-directory removal error asynchronously', (done) => {
    mkdirp.sync(root);
    fs.writeFileSync(path.join(root, 'keep'), 'keep');
    fixWinEPERM(root, originalError(), (error) => {
      fs.chmodSync(root, 0o755);
      assert.equal(error?.code, 'ENOTEMPTY');
      assert.equal(fs.readFileSync(path.join(root, 'keep'), 'utf8'), 'keep');
      done();
    });
  });
  if (isWindows) {
    // Directory unlink produces EPERM even when native file unlink handles read-only attributes.
    // The windows-latest CI job owns the attribute mutation assertions.
    function readOnlyDirectoryError(): NodeJS.ErrnoException {
      mkdirp.sync(root);
      fs.writeFileSync(path.join(root, 'keep'), 'keep');
      fs.chmodSync(root, 0o444);
      assert.equal(fs.statSync(root).mode & 0o222, 0);
      let original: NodeJS.ErrnoException | undefined;
      assert.throws(
        () => fs.unlinkSync(root),
        (error: unknown) => {
          original = error as NodeJS.ErrnoException;
          return original.code === 'EPERM';
        }
      );
      assert.equal(fs.statSync(root).mode & 0o222, 0);
      assert.equal(shouldFixEPERM(original as NodeJS.ErrnoException), true);
      return original as NodeJS.ErrnoException;
    }

    it('clears the Windows read-only directory attribute before returning ENOTEMPTY synchronously', () => {
      const original = readOnlyDirectoryError();
      assert.throws(
        () => fixWinEPERMSync(root, original),
        (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOTEMPTY'
      );
      assert.equal(fs.statSync(root).mode & 0o222, 0o222);
      assert.equal(fs.readFileSync(path.join(root, 'keep'), 'utf8'), 'keep');
    });

    it('clears the Windows read-only directory attribute before returning ENOTEMPTY asynchronously', (done) => {
      fixWinEPERM(root, readOnlyDirectoryError(), (error) => {
        assert.equal(error?.code, 'ENOTEMPTY');
        assert.equal(fs.statSync(root).mode & 0o222, 0o222);
        assert.equal(fs.readFileSync(path.join(root, 'keep'), 'utf8'), 'keep');
        done();
      });
    });
  }
});
