import assert from 'assert';
import fs from 'fs';
import { rm, safeRmSync } from 'fs-remove-compat';
import mkdirp from 'mkdirp-classic';
import path from 'path';

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
});
