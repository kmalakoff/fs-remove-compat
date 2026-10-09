import assert from 'assert';
import fs from 'fs';
import { rm, safeRmSync } from 'fs-remove-compat';
import mkdirp from 'mkdirp-classic';
import path from 'path';

import type { RmCallback } from '../../src/types.ts';
import { isWindows } from '../lib/platform.ts';
import { errorCode, intact, invalidOptions, nativeRm, options, tree } from '../lib/removal.ts';
import { createScratch, TMP_DIR } from '../lib/scratch.ts';

const { setupTmp, cleanTmp } = createScratch(safeRmSync);

describe('rm', () => {
  beforeEach(setupTmp);
  after(cleanTmp);

  it('should remove a file (callback style)', (done) => {
    const filePath = path.join(TMP_DIR, 'test-file-cb.txt');
    fs.writeFileSync(filePath, 'content');
    rm(filePath, (err) => {
      if (err) return done(err);
      assert.ok(!fs.existsSync(filePath), 'file should not exist after removal');
      done();
    });
  });

  it('should error when file does not exist (callback)', (done) => {
    rm(path.join(TMP_DIR, 'nonexistent.txt'), (err) => {
      assert.ok(err, 'should error');
      assert.equal(err?.code, 'ENOENT');
      done();
    });
  });

  it('should not error with force option (callback)', (done) => {
    rm(path.join(TMP_DIR, 'nonexistent.txt'), { force: true }, (err) => {
      assert.ok(!err);
      done();
    });
  });

  it('should remove directory recursively (callback)', (done) => {
    const dirPath = path.join(TMP_DIR, 'recursive-cb');
    mkdirp.sync(path.join(dirPath, 'subdir'));
    fs.writeFileSync(path.join(dirPath, 'file1.txt'), 'content1');
    fs.writeFileSync(path.join(dirPath, 'subdir', 'file2.txt'), 'content2');
    rm(dirPath, { recursive: true }, (err) => {
      if (err) return done(err);
      assert.ok(!fs.existsSync(dirPath), 'dir should not exist after removal');
      done();
    });
  });
  invalidOptions
    .filter((item) => !Array.isArray(item.options))
    .forEach((item) => {
      it(`rejects invalid options before mutation: ${JSON.stringify(item.options)}`, () => {
        const root = path.join(TMP_DIR, 'validation');
        tree(root);
        assert.equal(
          errorCode(() => rm(root, options(item.options), () => assert.fail('callback must not run'))),
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
        errorCode(() => rm(file, {}, value as RmCallback)),
        'ERR_INVALID_ARG_TYPE'
      );
      assert.equal(fs.readFileSync(file, 'utf8'), 'keep');
    }
  });
  it('rejects invalid options on a directory link before unlinking it', () => {
    const target = path.join(TMP_DIR, 'target');
    tree(target);
    const link = path.join(TMP_DIR, 'link');
    fs.symlinkSync(target, link, isWindows ? 'junction' : 'dir');
    assert.equal(
      errorCode(() => rm(link, options({ recursive: 'yes' }), () => assert.fail('callback'))),
      'ERR_INVALID_ARG_TYPE'
    );
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    intact(target);
  });
  it('matches this runtime native handling and timing of array options', (done) => {
    const root = path.join(TMP_DIR, 'array-options');
    tree(root);
    const oracle = path.join(TMP_DIR, 'oracle');
    tree(oracle);
    if (!nativeRm) {
      assert.equal(
        errorCode(() => rm(root, options([]), () => assert.fail('callback'))),
        'ERR_INVALID_ARG_TYPE'
      );
      intact(root);
      return done();
    }
    let nativeError: NodeJS.ErrnoException | undefined;
    try {
      nativeRm(oracle, options([]), (error) => {
        rm(root, options([]), (publicError) => {
          assert.equal(publicError?.code, error?.code);
          intact(root);
          intact(oracle);
          done();
        });
      });
    } catch (error) {
      nativeError = error as NodeJS.ErrnoException;
    }
    if (nativeError) {
      assert.equal(
        errorCode(() => rm(root, options([]), () => assert.fail('callback'))),
        nativeError.code
      );
      intact(root);
      intact(oracle);
      done();
    }
  });
});
