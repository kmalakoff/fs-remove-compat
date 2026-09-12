import assert from 'assert';
import fs from 'fs';
import { safeRm, safeRmSync } from 'fs-remove-compat';
import mkdirp from 'mkdirp-classic';
import path from 'path';

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
});
